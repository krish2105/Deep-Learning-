"""Decomposing predictive uncertainty into aleatoric and epistemic parts.

Two kinds of uncertainty look identical in a single sigmoid output but demand
opposite responses:

  * **Aleatoric** — irreducible noise in the data. A genuinely ambiguous film,
    a borderline opacity, an image degraded at acquisition. More training data
    does not help. The correct response is to flag ambiguity.

  * **Epistemic** — the model's own ignorance. The image is unlike anything in
    training. More data *would* help. The correct response is to abstain,
    because the model has no basis for an opinion.

Only epistemic uncertainty justifies abstention, so the system must separate
them. We estimate both from Monte-Carlo dropout: keep dropout active at
inference and sample T stochastic forward passes, treating the spread across
samples as a proxy for the posterior over weights (Gal & Ghahramani, 2016).

For a Bernoulli output the decomposition is exact:

    total (predictive entropy)  H[ E_t[p_t] ]
    aleatoric (expected entropy) E_t[ H[p_t] ]
    epistemic (mutual information) = total - aleatoric

The mutual information term is the BALD score. It is high exactly when
individual samples are each confident but disagree with each other — the
signature of a model guessing from an unfamiliar input.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .pathologies import PATHOLOGIES

EPS = 1e-12


def _bernoulli_entropy(p: np.ndarray) -> np.ndarray:
    """Binary entropy in nats, numerically safe at p = 0 and p = 1."""
    p = np.clip(p, EPS, 1.0 - EPS)
    return -(p * np.log(p) + (1.0 - p) * np.log1p(-p))


@dataclass(frozen=True)
class UncertaintyEstimate:
    """Per-pathology uncertainty decomposition from T MC-dropout samples."""

    mean: np.ndarray          # (14,) posterior predictive mean
    std: np.ndarray           # (14,) spread across samples
    total: np.ndarray         # (14,) predictive entropy
    aleatoric: np.ndarray     # (14,) expected entropy
    epistemic: np.ndarray     # (14,) mutual information (BALD)
    n_samples: int

    @property
    def max_epistemic(self) -> float:
        return float(np.max(self.epistemic))

    def dominant_source(self, index: int) -> str:
        """Which kind of uncertainty dominates for one pathology."""
        if self.total[index] < 0.10:
            return "confident"
        return "epistemic" if self.epistemic[index] > self.aleatoric[index] else "aleatoric"

    def to_dict(self) -> dict:
        return {
            "n_samples": self.n_samples,
            "max_epistemic": round(self.max_epistemic, 4),
            "per_label": {
                name: {
                    "mean": round(float(self.mean[i]), 4),
                    "std": round(float(self.std[i]), 4),
                    "total": round(float(self.total[i]), 4),
                    "aleatoric": round(float(self.aleatoric[i]), 4),
                    "epistemic": round(float(self.epistemic[i]), 4),
                    "dominant": self.dominant_source(i),
                }
                for i, name in enumerate(PATHOLOGIES)
            },
        }


def decompose(samples: np.ndarray) -> UncertaintyEstimate:
    """Decompose uncertainty from MC-dropout samples.

    samples: (T, 14) array of sigmoid outputs from T stochastic passes.
    """
    samples = np.asarray(samples, dtype=np.float64)
    if samples.ndim != 2:
        raise ValueError(f"expected (T, n_labels), got shape {samples.shape}")
    if samples.shape[0] < 2:
        raise ValueError("need at least 2 MC samples to estimate epistemic uncertainty")

    mean = samples.mean(axis=0)
    total = _bernoulli_entropy(mean)
    aleatoric = _bernoulli_entropy(samples).mean(axis=0)
    # Clip at zero: MI is non-negative, tiny negatives are floating-point noise.
    epistemic = np.maximum(total - aleatoric, 0.0)

    return UncertaintyEstimate(
        mean=mean,
        std=samples.std(axis=0),
        total=total,
        aleatoric=aleatoric,
        epistemic=epistemic,
        n_samples=int(samples.shape[0]),
    )


def confidence_to_chroma(probability: float, threshold: float) -> float:
    """Map a probability to the UI's saturation axis in [0, 1].

    The frontend renders confidence *as colour saturation* — a chip drains to
    neutral grey as the model becomes unsure. This function is the single
    source of truth for that mapping so the API and the UI cannot disagree.

    0.0 = fully achromatic (at or below the conformal threshold)
    1.0 = fully saturated (certain)
    """
    if probability <= threshold:
        return 0.0
    headroom = 1.0 - threshold
    if headroom <= EPS:
        return 1.0
    return float(np.clip((probability - threshold) / headroom, 0.0, 1.0))
