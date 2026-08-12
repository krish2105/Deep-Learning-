"""Request and response contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# ── auth ────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(default="", max_length=255)


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── analysis ────────────────────────────────────────────────────────────
class PathologyFinding(BaseModel):
    name: str
    display_name: str
    description: str
    probability: float
    threshold: float
    included: bool
    margin: float
    chroma: float = Field(description="UI saturation in [0,1]; 0 = achromatic")
    epistemic: float = 0.0
    aleatoric: float = 0.0
    dominant_uncertainty: str = "confident"
    urgency: float = 0.0


class ConformalOut(BaseModel):
    prediction_set: list[str]
    abstained: bool
    abstain_reason: str | None
    alpha: float
    coverage_target: float
    escalate: bool


class ProgressionOut(BaseModel):
    available: bool
    n_priors: int = 0
    trend: str = "unknown"          # improving | stable | worsening | unknown
    delta: dict[str, float] = Field(default_factory=dict)
    narrative: str = ""


class StudyOut(BaseModel):
    id: str
    patient_ref: str
    follow_up_index: int
    status: str
    mode: str
    image_url: str
    original_filename: str

    is_ood: bool
    ood_score: float
    abstained: bool
    abstain_reason: str

    findings: list[PathologyFinding] = Field(default_factory=list)
    conformal: ConformalOut | None = None
    progression: ProgressionOut | None = None
    gradcam: dict = Field(default_factory=dict)
    # Raw decomposition, so the uncertainty chart can plot the aleatoric and
    # epistemic components rather than re-deriving them in the browser.
    uncertainty: dict = Field(default_factory=dict)

    triage_score: float
    triage_priority: str
    triage_rationale: str

    report_text: str
    report_source: str

    reviewed_by: str
    review_note: str
    latency_ms: int
    error: str
    created_at: datetime

    model_config = {"from_attributes": True}


class WorklistItem(BaseModel):
    id: str
    patient_ref: str
    triage_priority: str
    triage_score: float
    triage_rationale: str
    abstained: bool
    is_ood: bool
    top_finding: str
    top_probability: float
    waited_minutes: float
    status: str
    created_at: datetime


class ReviewIn(BaseModel):
    note: str = Field(default="", max_length=4000)
    agree: bool = True


class AnalyzeOptions(BaseModel):
    patient_ref: str = Field(default="", max_length=64)
    follow_up_index: int = Field(default=0, ge=0)
    alpha: float | None = Field(default=None, gt=0.0, lt=1.0)


# ── fairness ────────────────────────────────────────────────────────────
class FairnessStratum(BaseModel):
    stratum: str
    value: str
    n: int
    auc: float
    sensitivity: float
    specificity: float


class FairnessReport(BaseModel):
    generated_at: datetime
    pathology: str
    strata: list[FairnessStratum]
    max_equalised_odds_gap: float
    within_tolerance: bool
    tolerance: float
    note: str
