"""SENTINEL-CXR orchestration API.

Deployed to Render's free tier: 512 MB RAM, 0.1 CPU. PyTorch does not fit in
that budget, so this service holds no deep-learning framework at all. Heavy
inference lives on Hugging Face Spaces (16 GB); this process orchestrates,
applies the conformal head in NumPy, persists, and degrades gracefully.

Run locally:  uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import init_db
from .routers import auth, studies, system

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s: %(message)s"
)
log = logging.getLogger("sentinel")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    log.info("%s v%s starting", settings.app_name, settings.version)
    if not settings.is_production:
        log.warning(
            "SECRET_KEY is the insecure development default. Set a real one "
            "before deploying."
        )
    if not settings.calibration_path.exists():
        log.warning(
            "No conformal calibration artefact. Coverage guarantees are NOT "
            "in force until the calibration notebook has been run."
        )
    yield
    log.info("shutting down")


app = FastAPI(
    title="SENTINEL-CXR API",
    description=(
        "Uncertainty-aware chest radiograph triage. "
        "Research prototype for MAIB AI 114 — not a medical device."
    ),
    version=settings.version,
    lifespan=lifespan,
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── rate limiting ───────────────────────────────────────────────────────
# In-process and per-instance. Adequate for a single free-tier dyno; a real
# deployment would use Redis. Stated rather than pretended.
_hits: dict[str, deque[float]] = defaultdict(deque)
_EXEMPT = {"/api/v1/health", "/api/v1/ready", "/docs", "/openapi.json", "/"}


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path in _EXEMPT:
        return await call_next(request)

    client = request.client.host if request.client else "unknown"
    now = time.time()
    window = _hits[client]
    while window and now - window[0] > 60.0:
        window.popleft()

    if len(window) >= settings.rate_limit_per_minute:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": (
                    f"Rate limit reached ({settings.rate_limit_per_minute} requests "
                    f"per minute). Wait a moment and try again."
                )
            },
        )
    window.append(now)
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "The server hit an unexpected error. The incident was logged. "
                "If this persists, check /api/v1/ready for backend status."
            )
        },
    )


app.include_router(auth.router)
app.include_router(studies.router)
app.include_router(system.router)


@app.get("/", tags=["system"])
async def root() -> dict:
    return {
        "service": settings.app_name,
        "version": settings.version,
        "description": "Uncertainty-aware chest radiograph triage",
        "docs": "/docs",
        "disclaimer": (
            "Research prototype built for the Deep Learning unit (MAIB AI 114) "
            "at S P Jain School of Global Management. Not a medical device. "
            "Must not be used for clinical decisions."
        ),
    }
