"""Split conformal prediction for multi-label chest radiograph classification.

Why conformal rather than a fixed 0.5 threshold
-----------------------------------------------
A sigmoid output is not a probability of being correct. Thresholding it at 0.5
gives no guarantee about how often the answer is right. Split conformal
prediction converts an arbitrary score into a *set* with a distribution-free,
finite-sample coverage guarantee: under exchangeability of calibration and test
data, the true label is contained in the predicted set with probability at
least 1 - alpha, regardless of whether the underlying model is well calibrated.

The method
----------
This is a multi-label problem, so we apply *per-label marginal* conformal
prediction. For each pathology k independently:

1. On a held-out calibration split, take the images where k is truly present.
2. Score each with nonconformity  s_i = 1 - p_ik  (low score = model agreed).
3. Set the threshold to the conformal quantile

       q_k = Quantile( {s_i}, ceil((n_k + 1)(1 - alpha)) / n_k )

   The (n+1)/n correction is what makes the guarantee finite-sample exact
   rather than asymptotic. Omitting it is the most common implementation error.
4. At test time include k in the prediction set iff  1 - p_k <= q_k.

Each label then carries marginal coverage >= 1 - alpha. Note this is a
*per-label* guarantee, not a simultaneous one over all 14 labels; claiming
joint coverage would require a Bonferroni or similar correction and is not
claimed anywhere in this system.

Abstention
----------
Coverage alone is not safety. A set containing 11 of 14 pathologies is
technically covering and clinically useless. The system abstains when:

  * the set is empty                      — no label met its threshold
  * the set is larger than `max_set_size`  — the model is diffusely unsure
  * epistemic uncertainty exceeds a bound  — see `uncertainty.py`
  * a critical finding sits just under its threshold — never silently drop it

Abstention routes the study to a human. It is the correct answer, not a failure.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .pathologies import CRITICAL, INDEX, N_PATHOLOGIES, PATHOLOGIES

# A critical finding within this margin of its threshold forces escalation.
CRITICAL_MARGIN = 0.08

# Used when a label has too few calibration positives to estimate a quantile.
MIN_CALIBRATION_POSITIVES = 20
FALLBACK_THRESHOLD = 0.50


@dataclass(frozen=True)
class ConformalResult:
    """Outcome of applying the conformal head to one score vector."""

    prediction_set: list[str]
    abstained: bool
    abstain_reason: str | None
    alpha: float
    coverage_target: float
    per_label: dict[str, dict[str, float]] = field(default_factory=dict)
    escalate: bool = False

    def to_dict(self) -> dict:
        return {
            "prediction_set": self.prediction_set,
            "abstained": self.abstained,
            "abstain_reason": self.abstain_reason,
            "alpha": self.alpha,
            "coverage_target": self.coverage_target,
            "per_label": self.per_label,
            "escalate": self.escalate,
        }


def conformal_quantile(scores: np.ndarray, alpha: float) -> float:
    """Finite-sample-corrected conformal quantile of nonconformity scores.

    Returns the smallest q such that at least ceil((n+1)(1-alpha)) of the n
    calibration scores are <= q. When the corrected rank exceeds n the
    guarantee cannot be met at this alpha with this much data, and we return
    1.0 (admit everything) rather than silently over-claim.
    """
    scores = np.asarray(scores, dtype=np.float64)
    n = scores.size
    if n == 0:
        return 1.0
    rank = math.ceil((n + 1) * (1.0 - alpha))
    if rank > n:
        return 1.0
    return float(np.sort(scores)[rank - 1])


class ConformalCalibrator:
    """Per-label conformal thresholds, fitted once and then frozen.

    Fit on a calibration split that is disjoint from both training and test
    data *and disjoint by patient*, not by image. See the spec, §4.
    """

    def __init__(self, alpha: float = 0.10, max_set_size: int = 6) -> None:
        if not 0.0 < alpha < 1.0:
            raise ValueError(f"alpha must be in (0, 1), got {alpha}")
        self.alpha = alpha
        self.max_set_size = max_set_size
        self.thresholds: np.ndarray = np.full(N_PATHOLOGIES, FALLBACK_THRESHOLD)
        self.n_calibration: np.ndarray = np.zeros(N_PATHOLOGIES, dtype=int)
        self.empirical_coverage: dict = {}
        self.provenance: dict = {}
        self.fitted = False

    def fit(self, probs: np.ndarray, labels: np.ndarray) -> "ConformalCalibrator":
        """Fit thresholds from calibration probabilities and binary labels.

        probs, labels: (n_samples, 14) arrays in canonical pathology order.
        """
        probs = np.asarray(probs, dtype=np.float64)
        labels = np.asarray(labels).astype(bool)
        if probs.shape != labels.shape:
            raise ValueError(f"shape mismatch: {probs.shape} vs {labels.shape}")
        if probs.shape[1] != N_PATHOLOGIES:
            raise ValueError(f"expected {N_PATHOLOGIES} columns, got {probs.shape[1]}")

        for k in range(N_PATHOLOGIES):
            positives = probs[labels[:, k], k]
            self.n_calibration[k] = positives.size
            if positives.size < MIN_CALIBRATION_POSITIVES:
                # Too few positives for a meaningful quantile. Say so rather
                # than pretending; `Hernia` genuinely is this rare.
                self.thresholds[k] = 1.0 - FALLBACK_THRESHOLD
                continue
            nonconformity = 1.0 - positives
            self.thresholds[k] = conformal_quantile(nonconformity, self.alpha)

        self.fitted = True
        return self

    def predict(
        self,
        probs: np.ndarray,
        epistemic: np.ndarray | None = None,
        epistemic_bound: float | None = None,
    ) -> ConformalResult:
        """Apply the fitted thresholds to one image's score vector."""
        probs = np.asarray(probs, dtype=np.float64).ravel()
        if probs.size != N_PATHOLOGIES:
            raise ValueError(f"expected {N_PATHOLOGIES} scores, got {probs.size}")

        nonconformity = 1.0 - probs
        included = nonconformity <= self.thresholds

        prediction_set = [PATHOLOGIES[k] for k in range(N_PATHOLOGIES) if included[k]]

        per_label = {
            PATHOLOGIES[k]: {
                "probability": round(float(probs[k]), 4),
                "threshold": round(float(1.0 - self.thresholds[k]), 4),
                "included": bool(included[k]),
                "margin": round(float(probs[k] - (1.0 - self.thresholds[k])), 4),
                "n_calibration": int(self.n_calibration[k]),
            }
            for k in range(N_PATHOLOGIES)
        }

        # A critical finding sitting just below its threshold must not vanish.
        escalate = any(
            not included[INDEX[p]]
            and probs[INDEX[p]] >= (1.0 - self.thresholds[INDEX[p]]) - CRITICAL_MARGIN
            for p in CRITICAL
        )

        abstained, reason = self._abstention_decision(
            prediction_set, probs, epistemic, epistemic_bound
        )

        return ConformalResult(
            prediction_set=prediction_set,
            abstained=abstained,
            abstain_reason=reason,
            alpha=self.alpha,
            coverage_target=round(1.0 - self.alpha, 4),
            per_label=per_label,
            escalate=escalate or abstained,
        )

    def _abstention_decision(
        self,
        prediction_set: list[str],
        probs: np.ndarray,
        epistemic: np.ndarray | None,
        epistemic_bound: float | None,
    ) -> tuple[bool, str | None]:
        if len(prediction_set) > self.max_set_size:
            return True, (
                f"Prediction set contains {len(prediction_set)} findings, above the "
                f"limit of {self.max_set_size}. The model is diffusely uncertain "
                f"rather than confident about several findings."
            )

        if epistemic is not None and epistemic_bound is not None:
            worst = float(np.max(epistemic))
            if worst > epistemic_bound:
                return True, (
                    f"Model uncertainty ({worst:.3f}) exceeds the acceptable bound "
                    f"({epistemic_bound:.3f}). This image is unlike the training "
                    f"distribution."
                )

        if not prediction_set:
            # An empty set with uniformly low scores is a confident negative.
            # An empty set with several near-threshold scores is not.
            near = int(np.sum(probs >= 0.30))
            if near >= 3:
                return True, (
                    "No finding met its coverage threshold, but several scored "
                    "close to it. The evidence is ambiguous."
                )

        return False, None

    # ── persistence ─────────────────────────────────────────────────────
    def save(self, path: str | Path) -> None:
        Path(path).write_text(
            json.dumps(
                {
                    "alpha": self.alpha,
                    "max_set_size": self.max_set_size,
                    "thresholds": self.thresholds.tolist(),
                    "n_calibration": self.n_calibration.tolist(),
                    "pathologies": list(PATHOLOGIES),
                },
                indent=2,
            )
        )

    @classmethod
    def load(cls, path: str | Path) -> "ConformalCalibrator":
        data = json.loads(Path(path).read_text())
        if list(data["pathologies"]) != list(PATHOLOGIES):
            raise ValueError("Calibration file pathology order does not match.")
        cal = cls(alpha=data["alpha"], max_set_size=data["max_set_size"])
        cal.thresholds = np.asarray(data["thresholds"], dtype=np.float64)
        cal.n_calibration = np.asarray(data["n_calibration"], dtype=int)
        # Realised coverage measured on the held-out split, carried alongside
        # the thresholds. A system claiming a guarantee must be able to show
        # what it ACHIEVED, not only what it aimed at.
        cal.empirical_coverage = data.get("empirical_coverage", {})
        cal.provenance = data.get("fitted_on", {})
        cal.fitted = True
        return cal


def empirical_coverage(
    probs: np.ndarray, labels: np.ndarray, calibrator: ConformalCalibrator
) -> dict[str, float]:
    """Measure realised coverage per label on a test split.

    This is the number that validates the system's central claim. It belongs in
    the report and it is asserted in CI.
    """
    probs = np.asarray(probs, dtype=np.float64)
    labels = np.asarray(labels).astype(bool)
    included = (1.0 - probs) <= calibrator.thresholds

    out: dict[str, float] = {}
    for k, name in enumerate(PATHOLOGIES):
        positives = labels[:, k]
        n = int(positives.sum())
        out[name] = float(included[positives, k].mean()) if n else float("nan")

    valid = [v for v in out.values() if not math.isnan(v)]
    out["_macro_average"] = float(np.mean(valid)) if valid else float("nan")
    out["_target"] = 1.0 - calibrator.alpha
    return out
