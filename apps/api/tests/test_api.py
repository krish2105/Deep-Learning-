"""End-to-end API tests with a stubbed inference backend.

The stub returns fixed, known score vectors. That is deliberate: these tests
verify *wiring and behaviour* — that the OOD gate fires before classification,
that abstention propagates into triage, that a rejected image never produces a
diagnosis — not model accuracy. Model accuracy is measured in the notebooks
against a held-out split, which is the only place it can honestly be measured.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.pathologies import INDEX, N_PATHOLOGIES
from app.services.inference_client import InferenceResult


def png_bytes(size: int = 224) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(
        (np.random.default_rng(0).random((size, size)) * 255).astype("uint8"), mode="L"
    ).save(buf, format="PNG")
    return buf.getvalue()


class StubInference:
    """Stands in for the HF Space. Configurable per test."""

    def __init__(self):
        self.probs = np.full(N_PATHOLOGIES, 0.05)
        self.ood_score = 0.0
        self.mc_samples = None
        self.mode = "full"

    async def analyze(self, image_bytes: bytes, want_gradcam: bool = True):
        return InferenceResult(
            probabilities=self.probs.copy(),
            mc_samples=self.mc_samples,
            ood_score=self.ood_score,
            gradcam={},
            mode=self.mode,
            backend="stub",
            latency_ms=5,
        )

    async def health(self):
        return {"inference_core": "warm", "fast_path": "stub"}

    async def wake(self):
        return True


@pytest_asyncio.fixture
async def ctx(tmp_path, monkeypatch):
    """Fresh in-memory app + stub backend for each test."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path}/t.db")

    import app.config as config

    config.get_settings.cache_clear()

    import importlib

    import app.db as db_mod

    importlib.reload(db_mod)

    import app.services.analysis as analysis
    import app.services.inference_client as ic
    import app.main as main

    importlib.reload(main)

    stub = StubInference()
    monkeypatch.setattr(ic, "get_inference_client", lambda: stub)
    monkeypatch.setattr(analysis, "get_inference_client", lambda: stub)
    analysis._calibrator = None
    analysis._policy = None

    await db_mod.init_db()

    async with AsyncClient(
        transport=ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "krishna@spjain.org",
                "password": "sentinel-cxr-2026",
                "full_name": "Krishna Mathur",
            },
        )
        assert r.status_code == 201, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        yield client, headers, stub


@pytest.mark.asyncio
class TestAuth:
    async def test_duplicate_email_rejected(self, ctx):
        client, _, _ = ctx
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": "krishna@spjain.org", "password": "another-password"},
        )
        assert r.status_code == 409

    async def test_login_and_me(self, ctx):
        client, _, _ = ctx
        r = await client.post(
            "/api/v1/auth/login",
            data={"username": "krishna@spjain.org", "password": "sentinel-cxr-2026"},
        )
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = await client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
        assert me.json()["email"] == "krishna@spjain.org"

    async def test_wrong_password_does_not_reveal_account_exists(self, ctx):
        client, _, _ = ctx
        known = await client.post(
            "/api/v1/auth/login",
            data={"username": "krishna@spjain.org", "password": "wrong"},
        )
        unknown = await client.post(
            "/api/v1/auth/login",
            data={"username": "nobody@spjain.org", "password": "wrong"},
        )
        assert known.status_code == unknown.status_code == 401
        assert known.json()["detail"] == unknown.json()["detail"]

    async def test_protected_route_requires_token(self, ctx):
        client, _, _ = ctx
        assert (await client.get("/api/v1/studies")).status_code == 401


@pytest.mark.asyncio
class TestAnalysis:
    async def test_clean_study_completes(self, ctx):
        client, headers, _ = ctx
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("cxr.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-001"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "complete"
        assert len(body["findings"]) == N_PATHOLOGIES
        assert body["report_text"]
        assert "not a medical device" in body["report_text"].lower()

    async def test_ood_image_is_rejected_without_diagnosis(self, ctx):
        """A rejected image must never come back with a diagnosis attached."""
        client, headers, stub = ctx
        stub.ood_score = 0.99
        stub.probs = np.full(N_PATHOLOGIES, 0.95)  # would look alarming if used

        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("cat.png", png_bytes(), "image/png")},
        )
        body = r.json()
        assert body["is_ood"]
        assert body["status"] == "rejected"
        assert body["conformal"] is None
        assert "rejected before analysis" in body["report_text"]
        assert "Not assessable" in body["report_text"]

    async def test_critical_finding_is_triaged_stat(self, ctx):
        client, headers, stub = ctx
        stub.probs = np.full(N_PATHOLOGIES, 0.02)
        stub.probs[INDEX["Pneumothorax"]] = 0.96

        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("cxr.png", png_bytes(), "image/png")},
        )
        body = r.json()
        assert body["triage_priority"] == "STAT"
        assert "time-critical" in body["triage_rationale"]

    async def test_mc_samples_produce_uncertainty_decomposition(self, ctx):
        client, headers, stub = ctx
        rng = np.random.default_rng(1)
        samples = np.clip(rng.normal(0.5, 0.3, (20, N_PATHOLOGIES)), 0.01, 0.99)
        stub.mc_samples = samples
        stub.probs = samples.mean(axis=0)

        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("cxr.png", png_bytes(), "image/png")},
        )
        body = r.json()
        assert body["findings"][0]["dominant_uncertainty"] in {
            "confident",
            "aleatoric",
            "epistemic",
        }

    async def test_chroma_is_zero_below_threshold(self, ctx):
        """Confidence-as-chroma: sub-threshold findings must be achromatic."""
        client, headers, stub = ctx
        stub.probs = np.full(N_PATHOLOGIES, 0.01)
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("cxr.png", png_bytes(), "image/png")},
        )
        for f in r.json()["findings"]:
            if not f["included"]:
                assert f["chroma"] == 0.0

    async def test_rejects_non_image_upload(self, ctx):
        client, headers, _ = ctx
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("notes.txt", b"this is not an image", "text/plain")},
        )
        assert r.status_code == 422
        assert "could not be read as an image" in r.json()["detail"]

    async def test_empty_upload_rejected(self, ctx):
        client, headers, _ = ctx
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("empty.png", b"", "image/png")},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
class TestProgressionAcrossStudies:
    async def test_second_study_compares_against_first(self, ctx):
        client, headers, stub = ctx

        stub.probs = np.full(N_PATHOLOGIES, 0.02)
        await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("v1.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-042", "follow_up_index": "0"},
        )

        stub.probs = np.full(N_PATHOLOGIES, 0.02)
        stub.probs[INDEX["Edema"]] = 0.85
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("v2.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-042", "follow_up_index": "1"},
        )

        prog = r.json()["progression"]
        assert prog["available"]
        assert prog["n_priors"] == 1
        assert prog["trend"] == "worsening"
        assert "Edema" in prog["delta"]

    async def test_studies_are_isolated_by_patient_ref(self, ctx):
        client, headers, stub = ctx
        await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("a.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-A"},
        )
        r = await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("b.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-B"},
        )
        assert not r.json()["progression"]["available"]


@pytest.mark.asyncio
class TestWorklist:
    async def test_ordered_by_triage_not_arrival(self, ctx):
        """The point of the RL agent: FIFO would bury the critical study."""
        client, headers, stub = ctx

        stub.probs = np.full(N_PATHOLOGIES, 0.02)
        stub.probs[INDEX["Fibrosis"]] = 0.80
        await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("routine.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-ROUTINE"},
        )

        stub.probs = np.full(N_PATHOLOGIES, 0.02)
        stub.probs[INDEX["Pneumothorax"]] = 0.94
        await client.post(
            "/api/v1/studies/analyze",
            headers=headers,
            files={"file": ("critical.png", png_bytes(), "image/png")},
            data={"patient_ref": "PT-CRITICAL"},
        )

        r = await client.get("/api/v1/studies/worklist", headers=headers)
        items = r.json()
        assert items[0]["patient_ref"] == "PT-CRITICAL", (
            "critical study uploaded second must still be read first"
        )
        assert items[0]["triage_priority"] == "STAT"


@pytest.mark.asyncio
class TestSystemSurfaces:
    async def test_health(self, ctx):
        client, _, _ = ctx
        assert (await client.get("/api/v1/health")).json()["status"] == "ok"

    async def test_calibration_warns_when_unfitted(self, ctx):
        """An uncalibrated system must say so, not imply a guarantee."""
        client, headers, _ = ctx
        body = (
            await client.get("/api/v1/studies/system/calibration", headers=headers)
        ).json()
        assert body["fitted"] is False
        assert "not guaranteed" in body["warning"].lower()

    async def test_fairness_reports_absence_honestly(self, ctx):
        client, headers, _ = ctx
        body = (await client.get("/api/v1/fairness", headers=headers)).json()
        assert body["available"] is False
        assert "notebooks/11_fairness_ethics.ipynb" in body["message"]

    async def test_root_carries_disclaimer(self, ctx):
        client, _, _ = ctx
        assert "not a medical device" in (await client.get("/")).json()["disclaimer"].lower()

    async def test_pathology_catalogue(self, ctx):
        client, headers, _ = ctx
        body = (await client.get("/api/v1/pathologies", headers=headers)).json()
        assert len(body["pathologies"]) == N_PATHOLOGIES
        assert any(p["critical"] for p in body["pathologies"])


@pytest.mark.asyncio
class TestReviewAndAudit:
    async def test_human_review_recorded(self, ctx):
        client, headers, _ = ctx
        study_id = (
            await client.post(
                "/api/v1/studies/analyze",
                headers=headers,
                files={"file": ("cxr.png", png_bytes(), "image/png")},
            )
        ).json()["id"]

        r = await client.post(
            f"/api/v1/studies/{study_id}/review",
            headers=headers,
            json={"note": "Agree, no acute finding.", "agree": True},
        )
        assert r.json()["reviewed_by"] == "Krishna Mathur"
        assert r.json()["review_note"] == "Agree, no acute finding."

    async def test_cannot_read_another_users_study(self, ctx):
        client, headers, _ = ctx
        study_id = (
            await client.post(
                "/api/v1/studies/analyze",
                headers=headers,
                files={"file": ("cxr.png", png_bytes(), "image/png")},
            )
        ).json()["id"]

        other = await client.post(
            "/api/v1/auth/register",
            json={"email": "atharva@spjain.org", "password": "another-password-x"},
        )
        other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

        r = await client.get(f"/api/v1/studies/{study_id}", headers=other_headers)
        assert r.status_code == 404
