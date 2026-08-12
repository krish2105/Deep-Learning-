"""The 14 NIH ChestX-ray14 pathologies and their clinical urgency.

Urgency drives triage ordering. It is derived from how quickly an untreated
finding causes harm, not from how often the model predicts it. Pneumothorax
outranks Emphysema because a tension pneumothorax kills in minutes while
emphysema is chronic.

These weights are a documented clinical prior, not a learned quantity. The DQN
in `triage.py` learns *on top of* them; it does not replace them.
"""

from __future__ import annotations

from typing import Final

# Canonical order. Every score vector in the system uses this order.
PATHOLOGIES: Final[tuple[str, ...]] = (
    "Atelectasis",
    "Cardiomegaly",
    "Consolidation",
    "Edema",
    "Effusion",
    "Emphysema",
    "Fibrosis",
    "Hernia",
    "Infiltration",
    "Mass",
    "Nodule",
    "Pleural_Thickening",
    "Pneumonia",
    "Pneumothorax",
)

N_PATHOLOGIES: Final[int] = len(PATHOLOGIES)

INDEX: Final[dict[str, int]] = {name: i for i, name in enumerate(PATHOLOGIES)}

# 1.0 = immediately life-threatening, 0.0 = incidental/chronic.
URGENCY: Final[dict[str, float]] = {
    "Pneumothorax": 1.00,   # tension pneumothorax — minutes
    "Edema": 0.85,          # acute pulmonary oedema — hours
    "Consolidation": 0.70,
    "Pneumonia": 0.70,
    "Mass": 0.65,           # malignancy workup — days, but never miss
    "Effusion": 0.55,
    "Cardiomegaly": 0.45,
    "Infiltration": 0.45,
    "Nodule": 0.40,
    "Atelectasis": 0.35,
    "Pleural_Thickening": 0.25,
    "Fibrosis": 0.20,
    "Emphysema": 0.20,
    "Hernia": 0.15,
}

# Findings that must never be silently dropped by abstention: if the model
# assigns meaningful probability to one of these, the study is escalated to a
# human even when the conformal set is empty.
CRITICAL: Final[frozenset[str]] = frozenset(
    {"Pneumothorax", "Edema", "Consolidation", "Pneumonia", "Mass"}
)

# Human-readable descriptions surfaced in the UI and the drafted report.
DESCRIPTIONS: Final[dict[str, str]] = {
    "Atelectasis": "Partial or complete collapse of a lung or lobe.",
    "Cardiomegaly": "Enlarged cardiac silhouette.",
    "Consolidation": "Alveolar air replaced by fluid or cells.",
    "Edema": "Fluid accumulation in the pulmonary interstitium or alveoli.",
    "Effusion": "Fluid in the pleural space.",
    "Emphysema": "Permanent enlargement of distal airspaces.",
    "Fibrosis": "Scarring and architectural distortion of lung tissue.",
    "Hernia": "Protrusion of abdominal contents into the thorax.",
    "Infiltration": "Ill-defined opacity of uncertain aetiology.",
    "Mass": "Discrete opacity greater than 3 cm.",
    "Nodule": "Discrete rounded opacity up to 3 cm.",
    "Pleural_Thickening": "Thickening of the pleural surface.",
    "Pneumonia": "Infective consolidation of lung parenchyma.",
    "Pneumothorax": "Air in the pleural space.",
}


def urgency_vector() -> list[float]:
    """Urgency weights in canonical `PATHOLOGIES` order."""
    return [URGENCY[p] for p in PATHOLOGIES]


def display_name(pathology: str) -> str:
    """`Pleural_Thickening` -> `Pleural Thickening`."""
    return pathology.replace("_", " ")
