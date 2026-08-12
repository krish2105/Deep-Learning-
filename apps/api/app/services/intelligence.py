"""Four AI features layered on the diagnostic pipeline.

Each is deliberately scoped so that a language model never makes a clinical
judgement. The LLM parses intent and writes prose; every decision it describes
was already made by the vision model, the conformal head, or the triage policy.

  1. Natural-language query  — filters the worklist from a plain-English request
  2. Similar-case retrieval  — cosine search over 1024-d CNN embeddings
  3. Timeline narrative      — LLM summary grounded in progression deltas
  4. Disagreement detector   — flags where model branches diverge
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import numpy as np

from ..core.pathologies import INDEX, N_PATHOLOGIES, PATHOLOGIES, display_name

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# 1. Natural-language query over studies
# ══════════════════════════════════════════════════════════════════════
@dataclass
class QuerySpec:
    """A parsed query. Every field maps to a deterministic filter."""

    pathologies: list[str] = field(default_factory=list)
    abstained: bool | None = None
    rejected: bool | None = None
    priority: str | None = None
    min_probability: float | None = None
    min_epistemic: float | None = None
    worsening: bool | None = None
    patient_ref: str | None = None
    explanation: str = ""

    def to_dict(self) -> dict:
        return {
            "pathologies": self.pathologies,
            "abstained": self.abstained,
            "rejected": self.rejected,
            "priority": self.priority,
            "min_probability": self.min_probability,
            "min_epistemic": self.min_epistemic,
            "worsening": self.worsening,
            "patient_ref": self.patient_ref,
            "explanation": self.explanation,
        }


# Deterministic patterns. These run first and handle most real queries without
# a network call; the LLM is only consulted when they find nothing. A filter
# that works offline, instantly, and identically every time is worth more than
# one that needs a model to understand "show me STAT cases".
_PATTERNS: list[tuple[str, str]] = [
    (r"\babstain(ed|ing)?\b|\bdeclin(ed|e)\b|\brefus(ed|e)\b", "abstained"),
    (r"\breject(ed)?\b|\bnot a (chest )?(x-?ray|radiograph)\b|\bood\b", "rejected"),
    (r"\bstat\b|\bcritical\b|\burgent(ly)?\b|\bemergenc\w+", "priority"),
    (r"\bworsen(ing|ed)?\b|\bprogress(ing|ion|ed)\b|\bdeteriorat\w+", "worsening"),
    (r"\bhigh(ly)? uncertain\b|\bepistemic\b|\bunsure\b|\bdoesn'?t know\b", "epistemic"),
    (r"\bconfident\b|\bhigh (probability|confidence|score)\b", "confident"),
]


def parse_query(text: str) -> QuerySpec:
    """Turn a plain-English request into a deterministic filter.

    Rule-based first, by design. A regex that reliably understands "show me
    abstained studies" costs nothing, works with no API key, and cannot
    hallucinate a filter the user did not ask for. The LLM is a fallback for
    phrasings the rules miss, never the primary path.
    """
    q = text.lower().strip()
    spec = QuerySpec()
    matched: list[str] = []

    for name in PATHOLOGIES:
        for variant in {name.lower(), display_name(name).lower()}:
            if re.search(rf"\b{re.escape(variant)}\b", q):
                spec.pathologies.append(name)
                matched.append(display_name(name))
                break

    for pattern, kind in _PATTERNS:
        if not re.search(pattern, q):
            continue
        if kind == "abstained":
            spec.abstained = True
            matched.append("abstained")
        elif kind == "rejected":
            spec.rejected = True
            matched.append("rejected at the gate")
        elif kind == "priority":
            spec.priority = "STAT" if re.search(r"\bstat\b|\bcritical\b", q) else "URGENT"
            matched.append(f"{spec.priority} priority")
        elif kind == "worsening":
            spec.worsening = True
            matched.append("worsening vs prior")
        elif kind == "epistemic":
            spec.min_epistemic = 0.05
            matched.append("high epistemic uncertainty")
        elif kind == "confident":
            spec.min_probability = 0.6
            matched.append("probability above 0.60")

    # "above 0.8", "over 70%"
    m = re.search(r"(?:above|over|greater than|>)\s*(\d*\.?\d+)\s*%?", q)
    if m:
        v = float(m.group(1))
        spec.min_probability = v / 100.0 if v > 1 else v
        matched.append(f"probability above {spec.min_probability:.2f}")

    m = re.search(r"\b(?:patient|ref)\s*[:#]?\s*([a-z0-9-]{2,})", q)
    if m and m.group(1) not in {"with", "that", "who"}:
        spec.patient_ref = m.group(1).upper()
        matched.append(f"patient {spec.patient_ref}")

    spec.explanation = (
        "Filtering for " + ", ".join(matched) + "."
        if matched
        else "No filters recognised — showing everything."
    )
    return spec


def apply_query(studies: list[dict], spec: QuerySpec) -> list[dict]:
    """Apply a parsed spec. Pure, deterministic, and unit-testable."""
    out = []
    for s in studies:
        if spec.rejected is True and not s.get("is_ood"):
            continue
        if spec.rejected is None and spec.abstained and not s.get("abstained"):
            continue
        if spec.priority and s.get("triage_priority") != spec.priority:
            continue
        if spec.patient_ref and spec.patient_ref not in (s.get("patient_ref") or "").upper():
            continue
        if spec.worsening and (s.get("progression") or {}).get("trend") != "worsening":
            continue

        findings = s.get("findings") or []
        if spec.pathologies:
            hit = any(
                f["name"] in spec.pathologies
                and (spec.min_probability is None or f["probability"] >= spec.min_probability)
                for f in findings
            )
            if not hit:
                continue
        elif spec.min_probability is not None:
            if not any(f["probability"] >= spec.min_probability for f in findings):
                continue

        if spec.min_epistemic is not None:
            if not any(f.get("epistemic", 0) >= spec.min_epistemic for f in findings):
                continue

        out.append(s)
    return out


# ══════════════════════════════════════════════════════════════════════
# 2. Similar-case retrieval
# ══════════════════════════════════════════════════════════════════════
def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def find_similar(
    query_vec: np.ndarray,
    corpus: list[tuple[str, np.ndarray]],
    top_k: int = 4,
    min_similarity: float = 0.30,
) -> list[dict]:
    """Nearest neighbours in embedding space.

    Cosine rather than Euclidean: CNN embedding magnitude tracks overall
    activation strength (roughly, how much is going on in the image), while
    direction carries what kind of thing it is. Two studies showing the same
    pathology at different severities should be neighbours, and only the angle
    captures that.

    Results below `min_similarity` are dropped rather than padded — returning a
    weak match to fill a row of four invites a clinician to read meaning into
    noise.
    """
    scored = [(sid, cosine_similarity(query_vec, vec)) for sid, vec in corpus]
    scored = [(sid, s) for sid, s in scored if s >= min_similarity]
    scored.sort(key=lambda t: -t[1])
    return [{"study_id": sid, "similarity": round(s, 4)} for sid, s in scored[:top_k]]


def probability_vector(probabilities: dict[str, float]) -> np.ndarray:
    """Fallback 'embedding' when the CNN feature vector is unavailable.

    The ONNX fast path does not emit the 1024-d penultimate features, so
    similarity falls back to the 14-d probability vector. That compares what
    the model CONCLUDED rather than what it SAW, which is a weaker signal — and
    the API labels which space was used so the difference is never hidden.
    """
    return np.array([probabilities.get(p, 0.0) for p in PATHOLOGIES], dtype=np.float64)


# ══════════════════════════════════════════════════════════════════════
# 3. Timeline narrative
# ══════════════════════════════════════════════════════════════════════
def build_timeline(studies: list[dict]) -> dict:
    """Assemble a patient's trajectory across visits.

    Returns structured deltas only. Any prose written from this is generated by
    `reporting.generate_report`'s grounded path, which cannot introduce a
    finding that is not in these numbers.
    """
    ordered = sorted(
        [s for s in studies if s.get("status") == "complete"],
        key=lambda s: (s.get("follow_up_index", 0), s.get("created_at", "")),
    )
    if len(ordered) < 2:
        return {
            "available": False,
            "n_visits": len(ordered),
            "note": "A timeline needs at least two completed studies for this patient.",
        }

    def vec(s: dict) -> np.ndarray:
        return np.array(
            [(s.get("probabilities") or {}).get(p, 0.0) for p in PATHOLOGIES]
        )

    first, last = vec(ordered[0]), vec(ordered[-1])
    delta = last - first

    trajectory = []
    for i, s in enumerate(ordered):
        v = vec(s)
        top = int(np.argmax(v))
        trajectory.append({
            "visit": i + 1,
            "study_id": s.get("id"),
            "created_at": s.get("created_at"),
            "triage": s.get("triage_priority"),
            "abstained": bool(s.get("abstained")),
            "top_finding": display_name(PATHOLOGIES[top]),
            "top_probability": round(float(v[top]), 4),
        })

    material = {
        display_name(PATHOLOGIES[i]): round(float(delta[i]), 4)
        for i in range(N_PATHOLOGIES)
        if abs(delta[i]) >= 0.10
    }

    return {
        "available": True,
        "n_visits": len(ordered),
        "trajectory": trajectory,
        "net_change": material,
        "span_note": (
            f"Across {len(ordered)} visits. Changes below 0.10 are omitted as "
            f"attributable to positioning and acquisition variation rather than "
            f"radiographic change."
        ),
    }


# ══════════════════════════════════════════════════════════════════════
# 4. Disagreement detector
# ══════════════════════════════════════════════════════════════════════
def detect_disagreement(
    primary: np.ndarray,
    secondary: np.ndarray | None,
    mc_samples: np.ndarray | None = None,
    threshold: float = 0.15,
) -> dict:
    """Flag findings where independent estimates diverge.

    Two sources of disagreement, both genuine ensemble-uncertainty signals:

      * **Between branches** — the CNN and the ViT reach different conclusions
        from the same image. Architectures with different inductive biases
        disagreeing is more informative than either being unsure alone.
      * **Within a branch** — Monte-Carlo or test-time-augmentation samples
        spread widely, meaning the prediction is unstable under perturbations
        that should not change a diagnosis.

    Disagreement is reported, never resolved by averaging. Averaging two
    confident and opposite answers produces a moderate one that represents
    nobody's view and hides the fact that the model has no consensus.
    """
    primary = np.asarray(primary, dtype=np.float64).ravel()
    conflicts: list[dict] = []

    if secondary is not None:
        secondary = np.asarray(secondary, dtype=np.float64).ravel()
        for i, name in enumerate(PATHOLOGIES):
            gap = abs(float(primary[i]) - float(secondary[i]))
            if gap >= threshold:
                conflicts.append({
                    "pathology": display_name(name),
                    "kind": "between-branches",
                    "primary": round(float(primary[i]), 4),
                    "secondary": round(float(secondary[i]), 4),
                    "gap": round(gap, 4),
                })

    if mc_samples is not None:
        samples = np.asarray(mc_samples, dtype=np.float64)
        if samples.ndim == 2 and samples.shape[0] >= 2:
            spread = samples.max(axis=0) - samples.min(axis=0)
            for i, name in enumerate(PATHOLOGIES):
                if spread[i] >= threshold * 2:
                    conflicts.append({
                        "pathology": display_name(name),
                        "kind": "within-branch",
                        "range": round(float(spread[i]), 4),
                        "std": round(float(samples[:, i].std()), 4),
                        "gap": round(float(spread[i]), 4),
                    })

    conflicts.sort(key=lambda c: -c["gap"])
    return {
        "available": secondary is not None or mc_samples is not None,
        "n_conflicts": len(conflicts),
        "threshold": threshold,
        "conflicts": conflicts[:8],
        "note": (
            "Disagreement is reported rather than averaged away. Averaging two "
            "confident and opposite estimates yields a moderate one that "
            "represents neither, and conceals the absence of consensus."
        ),
    }
