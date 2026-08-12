"""HTTP surface for the inference core — deployed to Hugging Face Spaces.

Free CPU Spaces provide 2 vCPU / 16 GB RAM and sleep after 48 hours of
inactivity. The orchestrator on Render calls `/wake` on page load so the Space
is starting while the user is still choosing a file.

Local:  uvicorn app:app --port 7860
Space:  the Dockerfile in this directory runs the same command on port 7860.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pipeline import PATHOLOGIES, get_pipeline

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("inference")

app = FastAPI(
    title="SENTINEL-CXR Inference Core",
    description=(
        "DenseNet-121 classification, VAE out-of-distribution gating, "
        "Monte-Carlo dropout uncertainty, and Grad-CAM. "
        "Research prototype — not a medical device."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_BYTES = 12 * 1024 * 1024


@app.on_event("startup")
async def warm() -> None:
    """Load weights at startup rather than on first request.

    Without this the first user after a 48-hour sleep pays both the container
    start and the model load.
    """
    get_pipeline()
    log.info("Inference core ready")


@app.get("/health")
async def health() -> dict:
    return get_pipeline().health()


@app.get("/")
async def root() -> dict:
    return {
        "service": "SENTINEL-CXR Inference Core",
        "pathologies": list(PATHOLOGIES),
        "docs": "/docs",
        "disclaimer": "Research prototype for MAIB AI 114. Not a medical device.",
    }


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...), gradcam: str = Form(default="true")
) -> dict:
    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_BYTES // (1024 * 1024)} MB.",
        )

    try:
        result = get_pipeline().analyze(
            image_bytes, want_gradcam=gradcam.lower() == "true"
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Inference failed")
        raise HTTPException(
            status_code=500, detail=f"Inference failed: {exc}"
        ) from exc

    return {
        "probabilities": result.probabilities,
        "mc_samples": result.mc_samples,
        "ood_score": result.ood_score,
        "gradcam": result.gradcam,
        "embedding": result.embedding,
        "backend": result.backend,
        "latency_ms": result.latency_ms,
        "pathologies": list(PATHOLOGIES),
    }
