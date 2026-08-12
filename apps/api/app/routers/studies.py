"""Study upload, analysis, worklist, and human review."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.pathologies import PATHOLOGIES, display_name
from ..db import AuditEntry, Study, User, get_db
from ..schemas import ReviewIn, StudyOut, WorklistItem
from ..security import get_current_user
from ..services import storage
from ..services.analysis import build_findings, get_calibrator, run_analysis
from ..services.inference_client import get_inference_client

router = APIRouter(prefix="/api/v1/studies", tags=["studies"])


def _to_out(study: Study) -> StudyOut:
    """Rehydrate the stored study into the API shape."""
    findings: list[dict] = []
    if study.probabilities and study.conformal:
        import numpy as np  # noqa: PLC0415

        from ..core.conformal import ConformalResult  # noqa: PLC0415
        from ..core.uncertainty import confidence_to_chroma  # noqa: PLC0415

        probs = np.array([study.probabilities.get(p, 0.0) for p in PATHOLOGIES])
        per_label = study.conformal.get("per_label", {})
        unc = (study.uncertainty or {}).get("per_label", {})

        from ..core.pathologies import DESCRIPTIONS, URGENCY  # noqa: PLC0415

        for i, name in enumerate(PATHOLOGIES):
            meta = per_label.get(name, {})
            threshold = meta.get("threshold", 0.5)
            u = unc.get(name, {})
            findings.append(
                {
                    "name": name,
                    "display_name": display_name(name),
                    "description": DESCRIPTIONS[name],
                    "probability": round(float(probs[i]), 4),
                    "threshold": threshold,
                    "included": meta.get("included", False),
                    "margin": meta.get("margin", 0.0),
                    "chroma": round(confidence_to_chroma(float(probs[i]), threshold), 4),
                    "epistemic": u.get("epistemic", 0.0),
                    "aleatoric": u.get("aleatoric", 0.0),
                    "dominant_uncertainty": u.get("dominant", "unknown"),
                    "urgency": URGENCY[name],
                }
            )
        findings.sort(key=lambda f: (not f["included"], -f["probability"]))

    return StudyOut(
        id=study.id,
        patient_ref=study.patient_ref,
        follow_up_index=study.follow_up_index,
        status=study.status,
        mode=study.mode,
        image_url=study.image_url,
        original_filename=study.original_filename,
        is_ood=study.is_ood,
        ood_score=study.ood_score,
        abstained=study.abstained,
        abstain_reason=study.abstain_reason,
        findings=findings,
        conformal=study.conformal or None,
        progression=study.progression or None,
        gradcam=study.gradcam or {},
        uncertainty=study.uncertainty or {},
        triage_score=study.triage_score,
        triage_priority=study.triage_priority,
        triage_rationale=study.triage_rationale,
        report_text=study.report_text,
        report_source=study.report_source,
        reviewed_by=study.reviewed_by,
        review_note=study.review_note,
        latency_ms=study.latency_ms,
        error=study.error,
        created_at=study.created_at,
    )


@router.post("/analyze", response_model=StudyOut, status_code=status.HTTP_201_CREATED)
async def analyze(
    file: UploadFile = File(...),
    patient_ref: str = Form(default=""),
    follow_up_index: int = Form(default=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudyOut:
    image_bytes = await file.read()

    try:
        storage.validate(image_bytes, file.filename or "upload")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    study = Study(
        owner_id=user.id,
        patient_ref=patient_ref.strip()[:64],
        follow_up_index=max(0, follow_up_index),
        original_filename=(file.filename or "upload")[:255],
        status="pending",
    )
    db.add(study)
    await db.flush()

    study.image_url, study.thumbnail_url = await storage.store(
        image_bytes, study.id, study.original_filename
    )

    study = await run_analysis(db, study, image_bytes, user.id)
    await db.refresh(study)
    return _to_out(study)


@router.get("", response_model=list[StudyOut])
async def list_studies(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[StudyOut]:
    rows = (
        await db.execute(
            select(Study)
            .where(Study.owner_id == user.id)
            .order_by(desc(Study.created_at))
            .limit(min(limit, 200))
        )
    ).scalars().all()
    return [_to_out(s) for s in rows]


@router.get("/worklist", response_model=list[WorklistItem])
async def worklist(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[WorklistItem]:
    """The reading queue, ordered by the triage policy rather than arrival time.

    This ordering is the point of the RL agent: FIFO would place a tension
    pneumothorax behind whatever happened to be uploaded first.
    """
    rows = (
        await db.execute(
            select(Study)
            .where(Study.owner_id == user.id, Study.status == "complete")
            .order_by(desc(Study.triage_score), desc(Study.created_at))
            .limit(100)
        )
    ).scalars().all()

    now = datetime.now(timezone.utc)
    items: list[WorklistItem] = []
    for s in rows:
        top_name, top_prob = "", 0.0
        if s.probabilities:
            top_name, top_prob = max(s.probabilities.items(), key=lambda kv: kv[1])

        created = s.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)

        items.append(
            WorklistItem(
                id=s.id,
                patient_ref=s.patient_ref or "—",
                triage_priority=s.triage_priority,
                triage_score=s.triage_score,
                triage_rationale=s.triage_rationale,
                abstained=s.abstained,
                is_ood=s.is_ood,
                top_finding=display_name(top_name) if top_name else "—",
                top_probability=round(top_prob, 4),
                waited_minutes=round((now - created).total_seconds() / 60.0, 1),
                status=s.status,
                created_at=s.created_at,
            )
        )
    return items


@router.get("/{study_id}", response_model=StudyOut)
async def get_study(
    study_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudyOut:
    study = (
        await db.execute(
            select(Study).where(Study.id == study_id, Study.owner_id == user.id)
        )
    ).scalar_one_or_none()
    if study is None:
        raise HTTPException(status_code=404, detail="Study not found.")
    return _to_out(study)


@router.post("/{study_id}/review", response_model=StudyOut)
async def review(
    study_id: str,
    payload: ReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StudyOut:
    """Record a human read. Closes the human-in-the-loop for abstained studies."""
    study = (
        await db.execute(
            select(Study).where(Study.id == study_id, Study.owner_id == user.id)
        )
    ).scalar_one_or_none()
    if study is None:
        raise HTTPException(status_code=404, detail="Study not found.")

    study.reviewed_by = user.full_name or user.email
    study.review_note = payload.note
    study.reviewed_at = datetime.now(timezone.utc)

    db.add(
        AuditEntry(
            user_id=user.id,
            study_id=study.id,
            action="human_review",
            detail={"agree": payload.agree, "had_abstained": study.abstained},
        )
    )
    await db.commit()
    await db.refresh(study)
    return _to_out(study)


@router.delete(
    "/{study_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def delete_study(
    study_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    study = (
        await db.execute(
            select(Study).where(Study.id == study_id, Study.owner_id == user.id)
        )
    ).scalar_one_or_none()
    if study is None:
        raise HTTPException(status_code=404, detail="Study not found.")
    db.add(
        AuditEntry(user_id=user.id, study_id=study.id, action="study_deleted", detail={})
    )
    await db.delete(study)
    await db.commit()


@router.get("/system/calibration", tags=["system"])
async def calibration_state() -> dict:
    """Expose the conformal thresholds actually in use.

    A system claiming a coverage guarantee should be able to show the numbers
    behind it. The UI surfaces this on the Uncertainty tab.
    """
    cal = get_calibrator()
    client = get_inference_client()
    return {
        "fitted": cal.fitted,
        "alpha": cal.alpha,
        "coverage_target": round(1.0 - cal.alpha, 4),
        "max_set_size": cal.max_set_size,
        "thresholds": {
            name: {
                "probability_threshold": round(float(1.0 - cal.thresholds[i]), 4),
                "n_calibration_positives": int(cal.n_calibration[i]),
            }
            for i, name in enumerate(PATHOLOGIES)
        },
        "warning": (
            None
            if cal.fitted
            else "Uncalibrated defaults in use. Coverage is not guaranteed until "
            "the calibration notebook has been run and its artefact deployed."
        ),
        "backends": await client.health(),
    }
