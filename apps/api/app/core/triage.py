"""Worklist triage — ordering studies so the sickest patient is read first.

The problem
-----------
A radiologist reads from a queue. Classical queues are first-in-first-out,
which means a tension pneumothorax can sit behind forty routine follow-ups.
Ordering the queue well is a *sequential decision* problem: the value of
reading a study now depends on what else is waiting and how long each has
already waited. That makes it a natural fit for reinforcement learning, and it
is where Week 9 of the syllabus enters the system.

The agent
---------
A Deep Q-Network is trained in `notebooks/08_dqn_triage.ipynb` against a
simulated reading room. State features per study:

    0  max critical-pathology probability
    1  urgency-weighted probability mass
    2  normalised wait time
    3  abstention flag (needs a human, so cannot be deferred indefinitely)
    4  epistemic uncertainty
    5  progression flag (worsening vs prior study)
    6  queue pressure (how many studies are waiting)

Reward penalises time-to-read weighted by true urgency, so the agent learns to
front-load studies whose delay costs the most. It is not rewarded for accuracy;
that is the classifier's job.

Serving
-------
Running a full DQN forward pass per study on a 512 MB / 0.1 CPU Render instance
is wasteful, so the notebook exports the trained network's final linear layer
as a weight vector. Scoring is then a dot product. If no exported policy is
present, `HeuristicPolicy` is used instead — a transparent clinical prior that
is documented, deterministic, and safe. The system never silently degrades to
random ordering.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from .pathologies import CRITICAL, INDEX, urgency_vector

N_FEATURES = 7
_URGENCY = np.asarray(urgency_vector(), dtype=np.float64)

# Wait time is normalised against this horizon. Beyond it, waiting no longer
# increases priority — a study four hours old is not twice as urgent as one two
# hours old, and letting wait dominate would starve genuinely critical cases.
WAIT_HORIZON_MINUTES = 120.0


class TriagePriority:
    """Priority bands surfaced in the worklist."""

    STAT = "STAT"
    URGENT = "URGENT"
    ROUTINE = "ROUTINE"

    @staticmethod
    def from_score(score: float) -> str:
        if score >= 0.70:
            return TriagePriority.STAT
        if score >= 0.40:
            return TriagePriority.URGENT
        return TriagePriority.ROUTINE


@dataclass(frozen=True)
class TriageDecision:
    score: float
    priority: str
    policy: str
    rationale: str

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 4),
            "priority": self.priority,
            "policy": self.policy,
            "rationale": self.rationale,
        }


def build_state(
    probabilities: np.ndarray,
    wait_minutes: float = 0.0,
    abstained: bool = False,
    max_epistemic: float = 0.0,
    progression_worsening: bool = False,
    queue_depth: int = 1,
) -> np.ndarray:
    """Assemble the 7-dimensional state vector for one waiting study."""
    probabilities = np.asarray(probabilities, dtype=np.float64).ravel()

    critical_max = max(
        (float(probabilities[INDEX[p]]) for p in CRITICAL), default=0.0
    )
    # Normalise against the *single most urgent* pathology, not the sum of all
    # of them. Dividing by the sum would make one certain pneumothorax score
    # ~0.14 simply because thirteen other findings were absent, which starves
    # exactly the cases this feature exists to catch.
    urgency_mass = float(
        min(np.dot(probabilities, _URGENCY) / _URGENCY.max(), 1.0)
    )

    return np.array(
        [
            critical_max,
            urgency_mass,
            min(wait_minutes / WAIT_HORIZON_MINUTES, 1.0),
            1.0 if abstained else 0.0,
            min(max_epistemic, 1.0),
            1.0 if progression_worsening else 0.0,
            min(queue_depth / 50.0, 1.0),
        ],
        dtype=np.float64,
    )


class Policy(Protocol):
    name: str

    def score(self, state: np.ndarray) -> float: ...

    def rationale(self, state: np.ndarray) -> str: ...


class HeuristicPolicy:
    """Transparent clinical prior. The documented fallback, never a silent one.

    Weights encode: a critical finding dominates; urgency mass and abstention
    matter next; waiting and worsening nudge upward. Deliberately simple so it
    can be reasoned about and defended in a viva.

    The critical weight is set so that a *freshly arrived* study with a
    confident time-critical finding clears the STAT band on its own, without
    needing to have waited or to be flagged by any other feature. A queue that
    only escalates a pneumothorax after it has aged is not a triage system.
    """

    name = "heuristic-v1"

    WEIGHTS = np.array([0.62, 0.18, 0.08, 0.10, 0.04, 0.07, 0.02])

    def score(self, state: np.ndarray) -> float:
        return float(np.clip(np.dot(state, self.WEIGHTS), 0.0, 1.0))

    def rationale(self, state: np.ndarray) -> str:
        return _explain(state)


class DQNPolicy:
    """Linear head exported from the trained DQN."""

    def __init__(self, weights: np.ndarray, bias: float, episodes: int) -> None:
        if weights.shape != (N_FEATURES,):
            raise ValueError(f"expected {N_FEATURES} weights, got {weights.shape}")
        self.weights = weights
        self.bias = bias
        self.name = f"dqn-v1-{episodes}ep"

    def score(self, state: np.ndarray) -> float:
        q = float(np.dot(state, self.weights) + self.bias)
        return float(1.0 / (1.0 + np.exp(-q)))  # squash to [0, 1]

    def rationale(self, state: np.ndarray) -> str:
        return _explain(state)

    @classmethod
    def load(cls, path: str | Path) -> "DQNPolicy":
        data = json.loads(Path(path).read_text())
        return cls(
            weights=np.asarray(data["weights"], dtype=np.float64),
            bias=float(data.get("bias", 0.0)),
            episodes=int(data.get("episodes", 0)),
        )


def _explain(state: np.ndarray) -> str:
    """Plain-language reason for the position in the queue."""
    critical, urgency, wait, abstained, epistemic, worsening, _ = state
    reasons: list[str] = []
    if critical >= 0.5:
        reasons.append("high probability of a time-critical finding")
    elif critical >= 0.25:
        reasons.append("possible time-critical finding")
    if abstained >= 0.5:
        reasons.append("model abstained, human read required")
    if worsening >= 0.5:
        reasons.append("worsening compared with prior study")
    if epistemic >= 0.3:
        reasons.append("image unlike the training distribution")
    if wait >= 0.75:
        reasons.append("has waited a long time")
    if not reasons:
        if urgency < 0.15:
            return "No urgent features. Routine queue position."
        return "Moderate findings only. Routine queue position."
    return "Prioritised: " + "; ".join(reasons) + "."


def load_policy(path: str | Path | None) -> Policy:
    """Load the trained DQN if available, else the documented heuristic."""
    if path and Path(path).exists():
        try:
            return DQNPolicy.load(path)
        except (ValueError, KeyError, json.JSONDecodeError):
            # A corrupt policy file must not take the service down, and must
            # not silently become random ordering.
            return HeuristicPolicy()
    return HeuristicPolicy()


def triage(state: np.ndarray, policy: Policy) -> TriageDecision:
    score = policy.score(state)
    return TriageDecision(
        score=score,
        priority=TriagePriority.from_score(score),
        policy=policy.name,
        rationale=policy.rationale(state),
    )
