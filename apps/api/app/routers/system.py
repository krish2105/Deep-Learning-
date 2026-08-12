"""Health, readiness, and the fairness audit surface."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter

from ..config import ARTIFACTS, get_settings
from ..services.inference_client import get_inference_client

router = APIRouter(prefix="/api/v1", tags=["system"])
settings = get_settings()

# Equalised-odds gap above which a model is considered to have failed the
# fairness gate. Set deliberately tight; see notebooks/11_fairness_ethics.ipynb.
FAIRNESS_TOLERANCE = 0.10


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.version,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ready")
async def ready() -> dict:
    """Readiness including which inference path is currently live.

    The frontend polls this to decide whether to show the REDUCED badge, and to
    warm a sleeping Space before the user uploads anything.
    """
    client = get_inference_client()
    backends = await client.health()
    return {
        "ready": True,
        "backends": backends,
        "gemini": "enabled" if settings.gemini_enabled else "template-fallback",
        "calibration": settings.calibration_path.exists(),
        "triage_policy": "dqn" if settings.policy_path.exists() else "heuristic",
        "mode": "full" if backends.get("inference_core") == "warm" else "reduced",
    }


@router.post("/wake")
async def wake() -> dict:
    """Wake a sleeping Hugging Face Space.

    Free Spaces sleep after 48 hours and take ~40s to start. The console calls
    this on mount so the Space is warming while the user is still choosing a
    file, rather than after they click Analyse.
    """
    woke = await get_inference_client().wake()
    return {"woken": woke}


@router.get("/fairness")
async def fairness() -> dict:
    """Fairness audit results produced by the evaluation notebook.

    Learning outcome E is assessed only in the final project, so this is a
    first-class surface rather than an appendix. If the audit has not been run,
    say so plainly instead of returning invented numbers.
    """
    path = ARTIFACTS / "fairness_report.json"
    if not path.exists():
        return {
            "available": False,
            "tolerance": FAIRNESS_TOLERANCE,
            "message": (
                "No fairness audit has been run. Execute "
                "notebooks/11_fairness_ethics.ipynb and place fairness_report.json "
                "in apps/api/artifacts/."
            ),
        }

    data = json.loads(path.read_text())
    data["available"] = True
    data["tolerance"] = FAIRNESS_TOLERANCE
    return data


@router.get("/pathologies")
async def pathologies() -> dict:
    from ..core.pathologies import (  # noqa: PLC0415
        CRITICAL,
        DESCRIPTIONS,
        PATHOLOGIES,
        URGENCY,
        display_name,
    )

    return {
        "pathologies": [
            {
                "name": p,
                "display_name": display_name(p),
                "description": DESCRIPTIONS[p],
                "urgency": URGENCY[p],
                "critical": p in CRITICAL,
            }
            for p in PATHOLOGIES
        ]
    }
