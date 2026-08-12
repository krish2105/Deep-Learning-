"""Ephemeral demo sandboxes.

A grader must be able to open the console and see a working clinical system
without creating an account, and without depending on the inference core being
awake. This module issues a throwaway user and seeds it with a worklist that
exercises every surface of the interface.

Two design decisions worth stating:

**Ephemeral, not shared.** Each visitor gets their own isolated user. A single
shared demo account on a public URL means whatever the last visitor uploaded is
what the next one sees, which on an assessed submission is an unacceptable risk.

**Seeded through the real code path.** The fixtures define only probability
vectors. Everything downstream — conformal thresholds, prediction sets,
abstention, chroma, triage priority, the drafted report — is computed by the
same functions that serve live traffic. Hand-writing the outputs would let the
demo drift out of agreement with the system it is demonstrating, and would
reintroduce exactly the class of bug where a displayed probability contradicts
its own inclusion decision.
"""

from __future__ import annotations

import base64
import io
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..core import progression as prog
from ..core import triage as tri
from ..core.pathologies import INDEX, N_PATHOLOGIES, PATHOLOGIES
from ..core.uncertainty import decompose
from ..db import AuditEntry, Study, User
from ..security import hash_password
from .analysis import build_findings, get_calibrator, get_policy
from .reporting import render_template

log = logging.getLogger(__name__)
settings = get_settings()

DEMO_ROLE = "demo"
DEMO_TTL_HOURS = 24
DEMO_PASSWORD = "demo-account-not-for-real-use"

_image_cache: dict[str, str] = {}


# ── synthetic imagery ────────────────────────────────────────────────────
def _phantom(seed: int, opacity: tuple[int, int, float] | None = None) -> Image.Image:
    """A stylised frontal chest radiograph.

    Drawn, not photographic. Presenting a fabricated image as a real patient
    radiograph would be dishonest, and using a real one raises provenance
    questions a demo cannot answer. The UI labels these as illustrations.
    """
    n = 512
    img = Image.new("L", (n, n), 8)
    d = ImageDraw.Draw(img)
    cx = n // 2

    d.ellipse([n * 0.10, n * 0.06, n * 0.90, n * 0.96], fill=60)
    d.ellipse([n * 0.20, n * 0.16, n * 0.46, n * 0.74], fill=22)
    d.ellipse([n * 0.54, n * 0.16, n * 0.80, n * 0.74], fill=22)
    d.rectangle([cx - 14, n * 0.14, cx + 14, n * 0.80], fill=110)
    for i in range(12):
        y = int(n * 0.16 + i * n * 0.055)
        d.rectangle([cx - 20, y, cx + 20, y + 4], fill=45)
    d.ellipse([cx - 95, n * 0.50, cx + 55, n * 0.82], fill=98)
    for i in range(9):
        y = int(n * 0.20 + i * n * 0.062)
        w = int(n * 0.20 + i * 3)
        d.arc([cx - w - 40, y - 30, cx - 6, y + 70], 300, 40, fill=95, width=4)
        d.arc([cx + 6, y - 30, cx + w + 40, y + 70], 140, 240, fill=95, width=4)
    d.arc([n * 0.16, n * 0.14, cx + 4, n * 0.28], 200, 340, fill=120, width=6)
    d.arc([cx - 4, n * 0.14, n * 0.84, n * 0.28], 200, 340, fill=120, width=6)
    d.arc([n * 0.16, n * 0.66, n * 0.84, n * 0.88], 190, 350, fill=88, width=6)

    arr = np.asarray(img).astype(np.float32)
    arr += np.random.default_rng(seed).normal(0, 4, arr.shape)

    if opacity is not None:
        ox, oy, strength = opacity
        yy, xx = np.mgrid[0:n, 0:n]
        arr += 255 * strength * np.exp(
            -(((xx - ox) ** 2) / (2 * 62**2) + ((yy - oy) ** 2) / (2 * 48**2))
        )

    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8")).filter(
        ImageFilter.GaussianBlur(1.1)
    )


def _not_a_radiograph() -> Image.Image:
    """An obviously non-medical image, for the rejection case."""
    img = Image.new("RGB", (512, 512), (58, 122, 84))
    d = ImageDraw.Draw(img)
    for i in range(0, 512, 46):
        d.ellipse([i, i // 2, i + 120, i // 2 + 96], fill=(226, 184, 66))
        d.rectangle([500 - i, 300, 540 - i, 470], fill=(120, 70, 40))
    return img


def _encode(img: Image.Image, max_px: int = 640) -> str:
    out = img.copy()
    out.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    out.convert("L").save(buf, format="WEBP", quality=80)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def _cam_overlay(x: int, y: int) -> str:
    """A Grad-CAM style heat overlay with alpha, centred on (x, y)."""
    n = 224
    yy, xx = np.mgrid[0:n, 0:n]
    a = np.exp(-(((xx - x) ** 2) / (2 * 26**2) + ((yy - y) ** 2) / (2 * 22**2)))
    rgba = np.zeros((n, n, 4), dtype=np.uint8)
    rgba[..., 0] = np.clip(255 * np.clip(a * 2 - 0.4, 0, 1), 0, 255)
    rgba[..., 1] = np.clip(255 * np.clip(1.6 - abs(a - 0.55) * 3.2, 0, 1), 0, 255)
    rgba[..., 2] = np.clip(255 * np.clip(1.0 - a * 2.2, 0, 1), 0, 255)
    rgba[..., 3] = (np.clip(a - 0.25, 0, 1) / 0.75 * 210).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _cached(key: str, factory) -> str:
    """Render each demo asset once per process; Render gives us 0.1 CPU."""
    if key not in _image_cache:
        _image_cache[key] = factory()
    return _image_cache[key]


# ── fixtures ─────────────────────────────────────────────────────────────
def _probs(**kwargs: float) -> np.ndarray:
    """Build a 14-vector from named pathologies, with a low background."""
    v = np.full(N_PATHOLOGIES, 0.03)
    for name, p in kwargs.items():
        v[INDEX[name]] = p
    return v


def _mc_samples(mean: np.ndarray, spread: float, seed: int, t: int = 20) -> np.ndarray:
    """Plausible posterior samples around a mean, for the uncertainty tab."""
    rng = np.random.default_rng(seed)
    logit = np.log(np.clip(mean, 1e-4, 1 - 1e-4) / (1 - np.clip(mean, 1e-4, 1 - 1e-4)))
    noisy = logit[None, :] + rng.normal(0, spread, (t, mean.size))
    return 1.0 / (1.0 + np.exp(-noisy))


FIXTURES = [
    {
        "key": "stat",
        "patient_ref": "DEMO-014",
        "follow_up": 0,
        "minutes_ago": 4,
        "probs": _probs(Pneumothorax=0.94, Atelectasis=0.31),
        "spread": 0.25,
        "image": ("stat", lambda: _encode(_phantom(11, opacity=(330, 190, 0.30)))),
        "cams": {"Pneumothorax": (140, 78)},
        "note": "Confident time-critical finding. Should sit at the top of the worklist.",
    },
    {
        "key": "progression-0",
        "patient_ref": "DEMO-007",
        "follow_up": 0,
        "minutes_ago": 190,
        "probs": _probs(Effusion=0.61, Cardiomegaly=0.44),
        "spread": 0.35,
        "image": ("prog0", lambda: _encode(_phantom(21))),
        "cams": {"Effusion": (72, 150)},
        "note": "Baseline study for the progression pair.",
    },
    {
        "key": "progression-1",
        "patient_ref": "DEMO-007",
        "follow_up": 1,
        "minutes_ago": 22,
        "probs": _probs(Effusion=0.88, Cardiomegaly=0.52, Edema=0.34),
        "spread": 0.30,
        "image": ("prog1", lambda: _encode(_phantom(21, opacity=(150, 340, 0.34)))),
        "cams": {"Effusion": (70, 156), "Cardiomegaly": (112, 138)},
        "note": "Follow-up showing worsening effusion versus the prior study.",
    },
    {
        "key": "abstain",
        "patient_ref": "DEMO-031",
        "follow_up": 0,
        "minutes_ago": 47,
        # Enough findings sit just above threshold that the prediction set
        # exceeds CONFORMAL_MAX_SET_SIZE (6). The model is diffusely unsure
        # rather than confident about several findings, which is precisely the
        # case abstention exists for. Values are kept above 0.5 so the set
        # survives the shift introduced by MC sampling.
        "probs": _probs(
            Infiltration=0.62, Consolidation=0.60, Pneumonia=0.59, Edema=0.58,
            Atelectasis=0.57, Effusion=0.56, Nodule=0.55, Mass=0.54,
        ),
        "spread": 0.85,          # wide disagreement across samples => epistemic
        "image": ("abstain", lambda: _encode(_phantom(33, opacity=(256, 256, 0.14)))),
        "cams": {},
        "note": "Diffuse uncertainty. The system declines and routes to a human.",
    },
    {
        "key": "ood",
        "patient_ref": "DEMO-099",
        "follow_up": 0,
        "minutes_ago": 9,
        "probs": _probs(Pleural_Thickening=0.52, Infiltration=0.50),
        "spread": 0.4,
        "image": ("ood", lambda: _encode(_not_a_radiograph())),
        "cams": {},
        "ood_score": 0.191,      # well above the 0.045 gate
        "note": "Not a chest radiograph. Rejected before classification runs.",
    },
]


# ── seeding ──────────────────────────────────────────────────────────────
def _build_study(fixture: dict, user_id: str, priors: list[np.ndarray]) -> Study:
    """Run a fixture through the real pipeline logic."""
    calibrator = get_calibrator()
    probs = fixture["probs"]
    created = datetime.now(timezone.utc) - timedelta(minutes=fixture["minutes_ago"])

    study = Study(
        owner_id=user_id,
        patient_ref=fixture["patient_ref"],
        follow_up_index=fixture["follow_up"],
        original_filename=f"{fixture['key']}.png",
        image_url=_cached(fixture["image"][0], fixture["image"][1]),
        mode="full",
        created_at=created,
        latency_ms=int(700 + abs(hash(fixture["key"])) % 900),
    )

    # ── out-of-distribution: reject before classifying, same as production
    ood = float(fixture.get("ood_score", 0.0))
    study.ood_score = ood
    if ood > settings.ood_threshold:
        study.is_ood = True
        study.status = "rejected"
        study.probabilities = {p: 0.0 for p in PATHOLOGIES}
        study.triage_priority = tri.TriagePriority.ROUTINE
        study.triage_rationale = "Rejected at the distributional gate. Not assessable."
        study.report_text = render_template({
            "findings": [], "conformal": {"coverage_target": 1 - settings.conformal_alpha,
                                          "prediction_set": []},
            "progression": {"available": False}, "triage": {},
            "is_ood": True, "ood_score": ood, "ood_threshold": settings.ood_threshold,
        })
        study.report_source = "template"
        return study

    # ── uncertainty
    samples = _mc_samples(probs, fixture["spread"], seed=abs(hash(fixture["key"])) % 10_000)
    unc = decompose(samples)
    mean = unc.mean
    study.uncertainty = unc.to_dict()
    study.probabilities = {p: round(float(mean[i]), 6) for i, p in enumerate(PATHOLOGIES)}

    # ── conformal + abstention
    conformal = calibrator.predict(
        mean, epistemic=unc.epistemic, epistemic_bound=settings.epistemic_bound
    )
    study.conformal = conformal.to_dict()
    study.abstained = conformal.abstained
    study.abstain_reason = conformal.abstain_reason or ""

    # ── progression
    progression = prog.compare(mean, priors) if priors else prog.ProgressionResult(
        available=False, narrative="No prior studies available for comparison."
    )
    study.progression = progression.to_dict()

    # ── triage
    decision = tri.triage(
        tri.build_state(
            probabilities=mean,
            wait_minutes=fixture["minutes_ago"],
            abstained=conformal.abstained,
            max_epistemic=unc.max_epistemic,
            progression_worsening=progression.worsening,
            queue_depth=len(FIXTURES),
        ),
        get_policy(),
    )
    study.triage_score = decision.score
    study.triage_priority = decision.priority
    study.triage_rationale = decision.rationale

    # ── explanation
    study.gradcam = {
        name: _cached(f"cam-{fixture['key']}-{name}", lambda xy=xy: _cam_overlay(*xy))
        for name, xy in fixture["cams"].items()
    }

    # ── report, via the deterministic renderer (no LLM call during seeding)
    findings = build_findings(mean, conformal, unc)
    study.report_text = render_template({
        "findings": findings,
        "conformal": conformal.to_dict(),
        "progression": progression.to_dict(),
        "triage": decision.to_dict(),
        "is_ood": False,
    })
    study.report_source = "template"
    study.status = "complete"
    return study


async def purge_expired(db: AsyncSession) -> int:
    """Remove demo users older than the TTL, and their studies with them."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=DEMO_TTL_HOURS)
    stale = (
        await db.execute(
            select(User).where(User.role == DEMO_ROLE, User.created_at < cutoff)
        )
    ).scalars().all()
    for user in stale:
        await db.delete(user)          # cascade removes their studies
    if stale:
        await db.execute(
            delete(AuditEntry).where(AuditEntry.user_id.in_([u.id for u in stale]))
        )
        log.info("purged %d expired demo sandboxes", len(stale))
    return len(stale)


async def create_sandbox(db: AsyncSession) -> User:
    """Issue a fresh guest user pre-loaded with the demo worklist."""
    await purge_expired(db)

    handle = uuid.uuid4().hex[:10]
    user = User(
        email=f"demo-{handle}@sentinel-cxr.local",
        hashed_password=hash_password(DEMO_PASSWORD),
        full_name="Demo Reviewer",
        role=DEMO_ROLE,
    )
    db.add(user)
    await db.flush()

    priors_by_patient: dict[str, list[np.ndarray]] = {}
    for fixture in FIXTURES:
        ref = fixture["patient_ref"]
        study = _build_study(fixture, user.id, priors_by_patient.get(ref, []))
        db.add(study)
        if not study.is_ood:
            priors_by_patient.setdefault(ref, []).append(
                np.array([study.probabilities[p] for p in PATHOLOGIES])
            )

    db.add(AuditEntry(
        user_id=user.id, action="demo_sandbox_created",
        detail={"studies": len(FIXTURES), "ttl_hours": DEMO_TTL_HOURS},
    ))
    await db.commit()
    await db.refresh(user)
    log.info("created demo sandbox %s with %d studies", user.id, len(FIXTURES))
    return user
