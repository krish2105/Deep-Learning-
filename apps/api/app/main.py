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

# Vercel mints a new hostname for every preview deployment, and the production
# alias changes if the project is renamed. Pinning an exact origin list means a
# redeploy silently breaks every browser request with an opaque CORS error --
# which is exactly what happened on the first live deployment. The regex covers
# all Vercel hosts and localhost; explicit ALLOWED_ORIGINS entries still apply
# on top. This is broader than a hospital deployment would permit, and is an
# accepted trade for a public, non-clinical prototype.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app|http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── rate limiting ───────────────────────────────────────────────────────
# In-process and per-instance. Adequate for a single free-tier dyno; a real
# deployment would use Redis. Stated rather than pretended.
_hits: dict[str, deque[float]] = defaultdict(deque)

# Cheap reads the single-page app fires on every navigation. Counting these
# against the same budget as an analysis meant a few page loads could exhaust
# the limit, producing a 429 that looked like a random failure.
_EXEMPT = {
    "/", "/docs", "/openapi.json",
    "/api/v1/health", "/api/v1/ready", "/api/v1/pathologies",
}

# Inference costs ~1s of a 0.1-CPU instance; a GET costs almost nothing. One
# shared budget had to be set low enough to protect the expensive path, which
# then throttled ordinary browsing.
WRITE_PATHS = ("/api/v1/studies/analyze", "/api/v1/auth/demo")
READ_BUDGET = 240      # per minute — a page load is ~7 calls
WRITE_BUDGET = 20      # per minute — protects the CPU


def _client_ip(request: Request) -> str:
    """The real caller's address, not the proxy's.

    Render sits behind Cloudflare, so request.client.host is the edge node.
    Bucketing on it puts EVERY visitor worldwide into one shared limit — the
    limiter then behaves as a global cap and fails users who did nothing wrong.
    Cloudflare's CF-Connecting-IP is authoritative here; X-Forwarded-For's first
    entry is the fallback.
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    path = request.url.path
    if path in _EXEMPT or request.method == "OPTIONS":
        return await call_next(request)

    is_write = any(path.startswith(p) for p in WRITE_PATHS)
    budget = WRITE_BUDGET if is_write else READ_BUDGET
    key = f"{'w' if is_write else 'r'}:{_client_ip(request)}"

    now = time.time()
    window = _hits[key]
    while window and now - window[0] > 60.0:
        window.popleft()

    if len(window) >= budget:
        retry_after = max(1, int(60.0 - (now - window[0])) + 1)
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(retry_after)},
            content={
                "detail": (
                    f"Too many requests. This endpoint allows {budget} per minute "
                    f"and you have reached it. Try again in {retry_after}s."
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
