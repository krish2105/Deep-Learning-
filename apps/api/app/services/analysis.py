"""The analysis pipeline — the one place the whole system comes together.

Order matters and is defended in the spec (§6):

    OOD gate → classify → uncertainty → conformal → abstain? → progression
    → triage → grounded report → persist

The gate runs first because classifying a photograph of a cat is not a smaller
error than misclassifying a radiograph — it is a category error, and the answer
must be refusal rather than a probability.
"""

from __future__ import annotations

import logging
import time

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..core import progression as prog
from ..core import triage as tri
from ..core.conformal import ConformalCalibrator
from ..core.pathologies import DESCRIPTIONS, PATHOLOGIES, URGENCY, display_name
from ..core.uncertainty import UncertaintyEstimate, confidence_to_chroma, decompose
from ..db import AuditEntry, Study
from .inference_client import InferenceResult, get_inference_client, label_map
from .reporting import generate_report, render_template

log = logging.getLogger(__name__)
settings = get_settings()

_calibrator: ConformalCalibrator | None = None
_policy: tri.Policy | None = None


def get_calibrator() -> ConformalCalibrator:
    """Fitted thresholds from the calibration notebook, or safe defaults."""
    global _calibrator
    if _calibrator is None:
        if settings.calibration_path.exists():
            _calibrator = ConformalCalibrator.load(settings.calibration_path)
            log.info("Loaded conformal calibration from %s", settings.calibration_path)
        else:
            _calibrator = ConformalCalibrator(
                alpha=settings.conformal_alpha,
                max_set_size=settings.conformal_max_set_size,
            )
            log.warning(
                "No calibration file; using uncalibrated defaults. Coverage is "
                "NOT guaranteed until notebooks/02_cnn_classifier.ipynb has been run."
            )
    return _calibrator


def get_policy() -> tri.Policy:
    global _policy
    if _policy is None:
        _policy = tri.load_policy(settings.policy_path)
        log.info("Triage policy: %s", _policy.name)
    return _policy


async def run_analysis(
    db: AsyncSession,
    study: Study,
    image_bytes: bytes,
    user_id: str,
) -> Study:
    started = time.perf_counter()
    client = get_inference_client()
    calibrator = get_calibrator()

    try:
        result: InferenceResult = await client.analyze(image_bytes)
    except Exception as exc:  # noqa: BLE001
        study.status = "failed"
        study.error = str(exc)
        await _audit(db, user_id, study.id, "analysis_failed", {"error": str(exc)})
        await db.commit()
        return study

    study.mode = result.mode
    study.ood_score = result.ood_score

    # ── 1. distributional gate ──────────────────────────────────────────
    if result.ood_score > settings.ood_threshold:
        study.probabilities = label_map(result.probabilities)
        study.is_ood = True
        study.status = "rejected"
        study.triage_priority = "ROUTINE"
        # Rendered through the single report renderer rather than composed here,
        # so rejection wording cannot drift away from every other report path.
        study.report_text = render_template(
            {
                "findings": [],
                "conformal": {"coverage_target": 1.0 - settings.conformal_alpha,
                              "prediction_set": []},
                "progression": {"available": False},
                "triage": {},
                "is_ood": True,
                "ood_score": result.ood_score,
                "ood_threshold": settings.ood_threshold,
            }
        )
        study.report_source = "template"
        await _audit(
            db, user_id, study.id, "ood_rejected", {"ood_score": result.ood_score}
        )
        study.latency_ms = int((time.perf_counter() - started) * 1000)
        await db.commit()
        return study

    # ── 2. uncertainty ──────────────────────────────────────────────────
    uncertainty: UncertaintyEstimate | None = None
    if result.mc_samples is not None and result.mc_samples.shape[0] >= 2:
        uncertainty = decompose(result.mc_samples)
        study.uncertainty = uncertainty.to_dict()
        probs = uncertainty.mean
    else:
        probs = result.probabilities
        study.uncertainty = {
            "n_samples": 0,
            "note": (
                "Uncertainty decomposition requires MC-dropout sampling, which "
                "runs only on the full inference path."
            ),
        }

    # Persist the *same* vector the decisions are made on. Storing the raw
    # single-pass scores while deciding on the posterior mean would let the
    # interface display a probability above its threshold next to "not
    # included" — a visible self-contradiction in a clinical tool.
    study.probabilities = label_map(probs)

    # ── 3. conformal prediction and abstention ──────────────────────────
    conformal = calibrator.predict(
        probs,
        epistemic=uncertainty.epistemic if uncertainty else None,
        epistemic_bound=settings.epistemic_bound if uncertainty else None,
    )
    study.conformal = conformal.to_dict()
    study.abstained = conformal.abstained
    study.abstain_reason = conformal.abstain_reason or ""

    if conformal.abstained:
        await _audit(
            db, user_id, study.id, "abstained", {"reason": conformal.abstain_reason}
        )

    # ── 4. progression against priors ───────────────────────────────────
    progression = prog.ProgressionResult(available=False)
    if study.patient_ref:
        priors = await _prior_probabilities(db, user_id, study.patient_ref, study.id)
        if priors:
            progression = prog.compare(probs, priors)
    study.progression = progression.to_dict()

    # ── 5. triage ───────────────────────────────────────────────────────
    queue_depth = await _queue_depth(db, user_id)
    state = tri.build_state(
        probabilities=probs,
        wait_minutes=0.0,
        abstained=conformal.abstained,
        max_epistemic=uncertainty.max_epistemic if uncertainty else 0.0,
        progression_worsening=progression.worsening,
        queue_depth=queue_depth,
    )
    decision = tri.triage(state, get_policy())
    study.triage_score = decision.score
    study.triage_priority = decision.priority
    study.triage_rationale = decision.rationale

    # ── 6. explanation ──────────────────────────────────────────────────
    study.gradcam = result.gradcam or {}

    # ── 7. grounded report ──────────────────────────────────────────────
    findings = build_findings(probs, conformal, uncertainty)
    report = await generate_report(
        {
            "findings": findings,
            "conformal": conformal.to_dict(),
            "progression": progression.to_dict(),
            "triage": decision.to_dict(),
            "is_ood": False,
        }
    )
    study.report_text = report.text
    study.report_source = report.source

    if not report.grounded:
        # A rejected generation is a safety event and is recorded as one.
        await _audit(
            db,
            user_id,
            study.id,
            "report_generation_rejected",
            {"reason": report.rejected_reason},
        )

    study.status = "complete"
    study.latency_ms = int((time.perf_counter() - started) * 1000)

    await _audit(
        db,
        user_id,
        study.id,
        "analysis_complete",
        {
            "mode": result.mode,
            "backend": result.backend,
            "abstained": conformal.abstained,
            "priority": decision.priority,
            "set_size": len(conformal.prediction_set),
            "latency_ms": study.latency_ms,
        },
    )
    await db.commit()
    return study


def build_findings(
    probs: np.ndarray,
    conformal,
    uncertainty: UncertaintyEstimate | None,
) -> list[dict]:
    """Per-pathology view for the API and the UI.

    `chroma` is computed here so the API and the frontend cannot disagree about
    how confidence maps to saturation.
    """
    out: list[dict] = []
    for i, name in enumerate(PATHOLOGIES):
        meta = conformal.per_label[name]
        threshold = meta["threshold"]
        probability = float(probs[i])
        out.append(
            {
                "name": name,
                "display_name": display_name(name),
                "description": DESCRIPTIONS[name],
                "probability": round(probability, 4),
                "threshold": threshold,
                "included": meta["included"],
                "margin": meta["margin"],
                "chroma": round(confidence_to_chroma(probability, threshold), 4),
                "epistemic": round(float(uncertainty.epistemic[i]), 4) if uncertainty else 0.0,
                "aleatoric": round(float(uncertainty.aleatoric[i]), 4) if uncertainty else 0.0,
                "dominant_uncertainty": (
                    uncertainty.dominant_source(i) if uncertainty else "unknown"
                ),
                "urgency": URGENCY[name],
            }
        )
    out.sort(key=lambda f: (not f["included"], -f["probability"]))
    return out


async def _prior_probabilities(
    db: AsyncSession, user_id: str, patient_ref: str, exclude_id: str
) -> list[np.ndarray]:
    rows = (
        await db.execute(
            select(Study)
            .where(
                Study.owner_id == user_id,
                Study.patient_ref == patient_ref,
                Study.id != exclude_id,
                Study.status == "complete",
            )
            .order_by(Study.follow_up_index, Study.created_at)
        )
    ).scalars().all()

    return [
        np.array([s.probabilities.get(p, 0.0) for p in PATHOLOGIES])
        for s in rows
        if s.probabilities
    ]


async def _queue_depth(db: AsyncSession, user_id: str) -> int:
    rows = (
        await db.execute(
            select(Study.id).where(
                Study.owner_id == user_id, Study.status.in_(["complete", "pending"])
            )
        )
    ).scalars().all()
    return len(rows)


async def _audit(
    db: AsyncSession, user_id: str, study_id: str, action: str, detail: dict
) -> None:
    db.add(
        AuditEntry(user_id=user_id, study_id=study_id, action=action, detail=detail)
    )
