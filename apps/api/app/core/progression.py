"""Change across a patient's prior studies.

NIH ChestX-ray14 averages 3-4 images per patient, keyed by `Patient ID` and
ordered by `Follow-up #`. That makes genuine longitudinal sequences available,
which is what lets the recurrent branch (syllabus weeks 4-5) do something
clinically meaningful rather than serve as a bolted-on exercise.

Two levels of answer:

  * **Observed change** — implemented here. Deterministic, explainable, always
    available: urgency-weighted delta between the current study and the most
    recent prior. This is what the interface shows.

  * **Forecast** — the LSTM on the inference core, which reads the sequence of
    per-visit CNN embeddings and predicts the *next* state. Trained and
    evaluated in `notebooks/04_lstm_ablation.ipynb`.

Keeping observed change separate from forecast matters: a clinician must be
able to see what actually changed without it being entangled with a prediction.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .pathologies import PATHOLOGIES, display_name, urgency_vector

_URGENCY = np.asarray(urgency_vector(), dtype=np.float64)

# Below this, a change is noise from acquisition and positioning rather than
# a real radiographic change.
MATERIAL_DELTA = 0.10

# Dead band on the urgency-weighted delta, so a material change that is
# balanced across improving and worsening findings reads as stable rather than
# tipping on floating-point noise.
TREND_EPSILON = 0.02


@dataclass(frozen=True)
class ProgressionResult:
    available: bool
    n_priors: int = 0
    trend: str = "unknown"
    delta: dict[str, float] = field(default_factory=dict)
    narrative: str = ""
    worsening: bool = False

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "n_priors": self.n_priors,
            "trend": self.trend,
            "delta": self.delta,
            "narrative": self.narrative,
            "worsening": self.worsening,
        }


def compare(current: np.ndarray, priors: list[np.ndarray]) -> ProgressionResult:
    """Compare the current study against prior studies, most recent last."""
    if not priors:
        return ProgressionResult(
            available=False,
            narrative="No prior studies available for comparison.",
        )

    current = np.asarray(current, dtype=np.float64).ravel()
    previous = np.asarray(priors[-1], dtype=np.float64).ravel()
    raw_delta = current - previous

    # Weight change by clinical urgency: a 0.2 rise in pneumothorax matters far
    # more than a 0.2 rise in hernia, and an unweighted mean would hide it.
    weighted = float(np.dot(raw_delta, _URGENCY) / _URGENCY.sum())

    material = {
        PATHOLOGIES[i]: round(float(raw_delta[i]), 4)
        for i in range(len(PATHOLOGIES))
        if abs(raw_delta[i]) >= MATERIAL_DELTA
    }

    # Trend is decided by *material* change only. Deciding it from the weighted
    # delta alone lets a uniform sub-threshold drift across all 14 labels read
    # as "worsening" while the findings list is empty — a report that
    # contradicts itself. If nothing moved materially, nothing changed.
    if not material:
        trend = "stable"
    elif weighted > TREND_EPSILON:
        trend = "worsening"
    elif weighted < -TREND_EPSILON:
        trend = "improving"
    else:
        trend = "stable"

    return ProgressionResult(
        available=True,
        n_priors=len(priors),
        trend=trend,
        delta=material,
        narrative=_narrate(trend, material, len(priors)),
        worsening=trend == "worsening",
    )


def _narrate(trend: str, delta: dict[str, float], n_priors: int) -> str:
    prior_phrase = (
        "the previous study" if n_priors == 1 else f"the most recent of {n_priors} priors"
    )

    if not delta:
        return (
            f"No material change compared with {prior_phrase}. "
            f"All differences fall below the {MATERIAL_DELTA:.2f} threshold "
            f"attributable to positioning and acquisition variation."
        )

    increased = sorted(
        ((k, v) for k, v in delta.items() if v > 0), key=lambda kv: -kv[1]
    )
    decreased = sorted(((k, v) for k, v in delta.items() if v < 0), key=lambda kv: kv[1])

    parts: list[str] = []
    if increased:
        parts.append(
            "Increased: "
            + ", ".join(f"{display_name(k)} (+{v:.2f})" for k, v in increased)
        )
    if decreased:
        parts.append(
            "Decreased: "
            + ", ".join(f"{display_name(k)} ({v:.2f})" for k, v in decreased)
        )

    return f"Compared with {prior_phrase}: {trend}. " + ". ".join(parts) + "."
