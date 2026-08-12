"""Endpoints for the four AI features."""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.pathologies import PATHOLOGIES
from ..db import AuditEntry, Study, User, get_db
from ..security import get_current_user
from ..services.intelligence import (
    apply_query,
    build_timeline,
    detect_disagreement,
    find_similar,
    parse_query,
    probability_vector,
)
from ..services.reporting import generate_report

router = APIRouter(prefix="/api/v1/intelligence", tags=["intelligence"])


async def _studies_as_dicts(db: AsyncSession, user_id: str) -> list[dict]:
    from .studies import _to_out  # noqa: PLC0415 - avoids a circular import

    rows = (
        await db.execute(
            select(Study).where(Study.owner_id == user_id).order_by(Study.created_at)
        )
    ).scalars().all()
    return [_to_out(s).model_dump() for s in rows]


@router.get("/query")
async def natural_language_query(
    q: str = Query(..., min_length=2, max_length=300),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Filter the worklist from a plain-English request.

    The language layer only ever produces a FILTER. It never decides what is
    wrong with a patient, and it cannot surface a study the deterministic
    filter would not have returned.
    """
    spec = parse_query(q)
    studies = await _studies_as_dicts(db, user.id)
    matched = apply_query(studies, spec)

    db.add(
        AuditEntry(
            user_id=user.id,
            action="nl_query",
            detail={"query": q, "spec": spec.to_dict(), "n_results": len(matched)},
        )
    )
    await db.commit()

    return {
        "query": q,
        "interpretation": spec.explanation,
        "spec": spec.to_dict(),
        "n_total": len(studies),
        "n_matched": len(matched),
        "study_ids": [s["id"] for s in matched],
    }


@router.get("/similar/{study_id}")
async def similar_cases(
    study_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Nearest neighbours in embedding space."""
    rows = (
        await db.execute(
            select(Study).where(
                Study.owner_id == user.id, Study.status == "complete"
            )
        )
    ).scalars().all()

    target = next((s for s in rows if s.id == study_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Study not found.")

    # The fast path does not emit the 1024-d penultimate features, so this
    # falls back to comparing the 14 probabilities. That compares conclusions
    # rather than appearance — a weaker signal, and the response says so.
    space = "probability-14d"
    query_vec = probability_vector(target.probabilities or {})
    corpus = [
        (s.id, probability_vector(s.probabilities or {}))
        for s in rows
        if s.id != study_id and s.probabilities
    ]

    matches = find_similar(query_vec, corpus)
    by_id = {s.id: s for s in rows}
    return {
        "study_id": study_id,
        "space": space,
        "note": (
            "Similarity is computed over the model's 14 output probabilities "
            "because the deployed fast path does not expose penultimate CNN "
            "features. This compares what the model concluded, not what it saw."
        ),
        "matches": [
            {
                **m,
                "patient_ref": by_id[m["study_id"]].patient_ref,
                "triage_priority": by_id[m["study_id"]].triage_priority,
                "thumbnail": by_id[m["study_id"]].thumbnail_url
                or by_id[m["study_id"]].image_url,
                "top_finding": max(
                    (by_id[m["study_id"]].probabilities or {}).items(),
                    key=lambda kv: kv[1],
                    default=("—", 0.0),
                )[0].replace("_", " "),
            }
            for m in matches
        ],
    }


@router.get("/timeline/{patient_ref}")
async def patient_timeline(
    patient_ref: str,
    narrate: bool = True,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Longitudinal summary across a patient's visits."""
    studies = [
        s for s in await _studies_as_dicts(db, user.id)
        if (s.get("patient_ref") or "").upper() == patient_ref.upper()
    ]
    for s, row in zip(
        studies,
        (
            await db.execute(
                select(Study).where(
                    Study.owner_id == user.id, Study.patient_ref == patient_ref
                ).order_by(Study.follow_up_index, Study.created_at)
            )
        ).scalars().all(),
    ):
        s["probabilities"] = row.probabilities

    timeline = build_timeline(studies)

    if timeline["available"] and narrate:
        latest = studies[-1]
        report = await generate_report(
            {
                "findings": latest.get("findings", []),
                "conformal": latest.get("conformal") or {},
                "progression": {
                    "available": True,
                    "narrative": (
                        f"Across {timeline['n_visits']} visits, net change: "
                        + (
                            ", ".join(
                                f"{k} {v:+.2f}" for k, v in timeline["net_change"].items()
                            )
                            or "no material change"
                        )
                    ),
                },
                "triage": {},
                "is_ood": False,
            }
        )
        timeline["narrative"] = report.text
        timeline["narrative_source"] = report.source

    return {"patient_ref": patient_ref, **timeline}


@router.get("/disagreement/{study_id}")
async def disagreement(
    study_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Where independent estimates of the same image diverge."""
    study = (
        await db.execute(
            select(Study).where(Study.id == study_id, Study.owner_id == user.id)
        )
    ).scalar_one_or_none()
    if study is None:
        raise HTTPException(status_code=404, detail="Study not found.")

    primary = np.array([(study.probabilities or {}).get(p, 0.0) for p in PATHOLOGIES])

    # MC / TTA samples are not persisted, so within-branch spread is
    # reconstructed from the stored per-label standard deviations.
    per_label = (study.uncertainty or {}).get("per_label") or {}
    samples = None
    if per_label:
        means = np.array([per_label.get(p, {}).get("mean", 0.0) for p in PATHOLOGIES])
        stds = np.array([per_label.get(p, {}).get("std", 0.0) for p in PATHOLOGIES])
        # Two synthetic draws at +/- 1 sd reproduce the recorded spread without
        # inventing a distribution shape we did not measure.
        samples = np.clip(np.stack([means - stds, means + stds]), 0.0, 1.0)

    return {
        "study_id": study_id,
        **detect_disagreement(primary, secondary=None, mc_samples=samples),
    }
