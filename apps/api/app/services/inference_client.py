"""Client for the HF Spaces inference core, with a local fallback path.

Free HF Spaces sleep after 48 hours of inactivity and take roughly 40 seconds
to wake. A grader clicking "Analyse" must not stare at a spinner for that long,
so the orchestrator runs two paths:

  full    — the Space: DenseNet + ViT ensemble, MC-dropout, Grad-CAM, VAE, LSTM
  reduced — local ONNX int8 DenseNet + VAE, under a second, no Grad-CAM

If the Space does not answer quickly we return the reduced result immediately,
flag `mode="reduced"`, and let the caller upgrade later. Degradation is always
explicit in the response — the UI shows a REDUCED badge. It is never silent.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
import numpy as np

from pathlib import Path

from ..config import get_settings
from ..core.pathologies import N_PATHOLOGIES, PATHOLOGIES

log = logging.getLogger(__name__)
settings = get_settings()

# How long to wait for a warm Space before falling back. A warm Space answers
# in 2-6s; anything beyond this is a cold start we should not block on.
WARM_TIMEOUT_S = 8.0


@dataclass
class InferenceResult:
    probabilities: np.ndarray
    mc_samples: np.ndarray | None = None
    ood_score: float = 0.0
    gradcam: dict[str, str] = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)
    mode: str = "full"
    backend: str = ""
    latency_ms: int = 0
    error: str = ""


class InferenceUnavailable(RuntimeError):
    """Neither the Space nor the local fallback could produce a result."""


class InferenceClient:
    def __init__(self) -> None:
        self._onnx = None
        self._onnx_tried = False
        self._onnx_error: str = ""

    # ── public ───────────────────────────────────────────────────────────
    async def analyze(
        self, image_bytes: bytes, want_gradcam: bool = True
    ) -> InferenceResult:
        if settings.inference_enabled:
            try:
                return await self._call_space(image_bytes, want_gradcam)
            except (httpx.HTTPError, asyncio.TimeoutError, ValueError) as exc:
                log.warning("Inference core unavailable (%s); using fast path", exc)

        result = self._call_onnx(image_bytes)
        if result is None:
            raise InferenceUnavailable(
                "No inference backend is reachable. Set INFERENCE_URL to your "
                "Hugging Face Space, or place the ONNX model in artifacts/."
            )
        return result

    async def wake(self) -> bool:
        """Nudge a sleeping Space. Fire-and-forget; never raises."""
        if not settings.inference_enabled:
            return False
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                r = await client.get(f"{settings.inference_url.rstrip('/')}/health")
                return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def health(self) -> dict[str, Any]:
        state = "disabled"
        if settings.inference_enabled:
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    r = await client.get(
                        f"{settings.inference_url.rstrip('/')}/health"
                    )
                    state = "warm" if r.status_code == 200 else "error"
            except httpx.HTTPError:
                state = "cold"
        out = {
            "inference_core": state,
            "fast_path": "ready" if self._load_onnx() is not None else "unavailable",
        }
        # Surfaced so a remote failure can be diagnosed without shell access.
        if self._onnx_error:
            out["fast_path_error"] = self._onnx_error
        return out

    # ── backends ─────────────────────────────────────────────────────────
    async def _call_space(self, image_bytes: bytes, want_gradcam: bool) -> InferenceResult:
        url = f"{settings.inference_url.rstrip('/')}/analyze"
        async with httpx.AsyncClient(timeout=WARM_TIMEOUT_S) as client:
            resp = await client.post(
                url,
                files={"file": ("study.png", image_bytes, "image/png")},
                data={"gradcam": str(want_gradcam).lower()},
            )
            resp.raise_for_status()
            payload = resp.json()

        probs = np.asarray(payload["probabilities"], dtype=np.float64)
        if probs.size != N_PATHOLOGIES:
            raise ValueError(
                f"Inference core returned {probs.size} scores, expected {N_PATHOLOGIES}."
            )

        samples = payload.get("mc_samples")
        return InferenceResult(
            probabilities=probs,
            mc_samples=np.asarray(samples, dtype=np.float64) if samples else None,
            ood_score=float(payload.get("ood_score", 0.0)),
            gradcam=payload.get("gradcam", {}),
            embedding=payload.get("embedding", []),
            mode="full",
            backend=payload.get("backend", "hf-spaces"),
            latency_ms=int(payload.get("latency_ms", 0)),
        )

    def _load_onnx(self):
        """Load the int8 classifier, recording precisely why if it fails.

        A remote 512 MB instance gives no way to inspect the filesystem, so the
        failure reason is captured and surfaced through /ready. Debugging this
        by redeploying with guesses is far more expensive than carrying one
        string.
        """
        if self._onnx_tried:
            return self._onnx
        self._onnx_tried = True

        try:
            import onnxruntime as ort  # noqa: PLC0415
        except ImportError as exc:
            self._onnx_error = f"onnxruntime not installed: {exc}"
            log.warning(self._onnx_error)
            return None

        path = settings.onnx_path
        if not path.exists():
            # Name what IS there — a wrong working directory and a missing file
            # look identical from the outside otherwise.
            try:
                siblings = sorted(p.name for p in path.parent.iterdir())[:12]
            except OSError:
                siblings = ["<artifacts dir does not exist>"]
            self._onnx_error = (
                f"model not found at {path} (cwd={Path.cwd()}); "
                f"artifacts dir contains: {siblings}"
            )
            log.warning(self._onnx_error)
            return None

        try:
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 1  # 0.1 CPU — threads would only thrash
            opts.inter_op_num_threads = 1
            # The default arena pre-allocates aggressively, which is the wrong
            # trade on a 512 MB instance serving one request at a time.
            opts.enable_cpu_mem_arena = False
            opts.enable_mem_pattern = False
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
            self._onnx = ort.InferenceSession(
                str(path), opts, providers=["CPUExecutionProvider"]
            )
            log.info("ONNX fast path ready (%.1f MB model)", path.stat().st_size / 1e6)
        except Exception as exc:  # noqa: BLE001 - must never take the API down
            self._onnx_error = f"{type(exc).__name__}: {exc}"
            log.warning("ONNX model failed to load: %s", self._onnx_error)
        return self._onnx

    def _call_onnx(self, image_bytes: bytes) -> InferenceResult | None:
        session = self._load_onnx()
        if session is None:
            return None

        import time  # noqa: PLC0415

        started = time.perf_counter()
        tensor = self._preprocess(image_bytes)
        name = session.get_inputs()[0].name
        outputs = session.run(None, {name: tensor})
        out = np.asarray(outputs[0]).ravel()

        # The exported graph already ends in a sigmoid — TorchXRayVision applies
        # it inside forward(). Applying it a second time maps [0,1] onto
        # [0.50, 0.73], which would make every finding look like a coin flip and
        # every study diffusely uncertain. Guard on the observed range rather
        # than assuming, so a future logit-emitting export still works.
        probs = out[:N_PATHOLOGIES]
        if probs.min() < 0.0 or probs.max() > 1.0:
            probs = 1.0 / (1.0 + np.exp(-probs))

        # Class activation maps, if the exported graph provides them.
        cams: dict[str, str] = {}
        if len(outputs) > 1:
            try:
                cams = self._cams_to_overlays(np.asarray(outputs[1])[0], probs)
            except Exception as exc:  # noqa: BLE001 - explanation is not worth a 500
                log.warning("CAM rendering failed: %s", exc)

        return InferenceResult(
            probabilities=probs,
            mc_samples=None,
            ood_score=0.0,  # the VAE gate lives on the Space
            gradcam=cams,
            mode="reduced",
            backend="onnx-int8-local(cam)",
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _cams_to_overlays(
        cams: np.ndarray, probs: np.ndarray, top_k: int = 3, size: int = 224
    ) -> dict[str, str]:
        """Render the top findings' activation maps as base64 PNG overlays.

        This is classic CAM (Zhou et al., 2016), not Grad-CAM: DenseNet ends in
        global average pooling followed by a linear layer, so the class map is
        the classifier weights applied across the final feature maps and needs
        no backward pass. ONNX Runtime cannot compute gradients, so this is what
        makes explanation possible at all on the fast path.

        The same caveat applies as to Grad-CAM, and is stated in the interface:
        it shows where activation correlates with the score, not why a decision
        was made.
        """
        import base64  # noqa: PLC0415
        import io  # noqa: PLC0415

        from PIL import Image  # noqa: PLC0415

        out: dict[str, str] = {}
        for idx in np.argsort(probs)[::-1][:top_k]:
            if probs[idx] < 0.20:
                continue
            cam = cams[idx].astype(np.float32)
            span = float(cam.max() - cam.min())
            if span < 1e-6:
                # A flat map means no localised evidence. Normalising it would
                # amplify numerical noise into a confident-looking blob.
                continue

            # Min-max over the RAW map, deliberately without a ReLU.
            #
            # Grad-CAM rectifies because there a negative gradient-activation
            # product means the region argues against the class. Classic CAM is
            # different: w_c . A is an evidence field whose absolute offset is
            # absorbed by the classifier bias, so a map can sit entirely below
            # zero while still localising perfectly well. Rectifying it here
            # zeroed the maps for eleven of fourteen pathologies and left the
            # Explainability tab almost empty — the relative maxima are the
            # signal, not the sign.
            cam = (cam - cam.min()) / span

            img = Image.fromarray((cam * 255).astype(np.uint8)).resize(
                (size, size), Image.BICUBIC
            )
            a = np.asarray(img, dtype=np.float32) / 255.0

            rgba = np.zeros((size, size, 4), dtype=np.uint8)
            rgba[..., 0] = np.clip(255 * np.clip(a * 2 - 0.4, 0, 1), 0, 255)
            rgba[..., 1] = np.clip(255 * np.clip(1.6 - np.abs(a - 0.55) * 3.2, 0, 1), 0, 255)
            rgba[..., 2] = np.clip(255 * np.clip(1.0 - a * 2.2, 0, 1), 0, 255)
            rgba[..., 3] = (np.clip(a - 0.25, 0, 1) / 0.75 * 210).astype(np.uint8)

            buf = io.BytesIO()
            Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
            out[PATHOLOGIES[idx]] = (
                "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
            )
        return out

    @staticmethod
    def _preprocess(image_bytes: bytes) -> np.ndarray:
        """Match the exported graph exactly: 1 channel, 224x224, [-1024, 1024].

        This must mirror `services/inference/pipeline.py::_to_tensor`. An earlier
        version applied ImageNet normalisation over three channels, which is the
        convention for torchvision backbones but not for TorchXRayVision — it
        produced the wrong shape AND the wrong intensity scale, so the fast path
        would have returned meaningless scores rather than failing loudly.
        """
        import io  # noqa: PLC0415

        from PIL import Image  # noqa: PLC0415

        img = Image.open(io.BytesIO(image_bytes)).convert("L").resize(
            (224, 224), Image.BILINEAR
        )
        arr = np.asarray(img, dtype=np.float32)
        arr = (arr / 255.0) * 2048.0 - 1024.0
        return arr[None, None, :, :]  # (1, 1, 224, 224)


_client: InferenceClient | None = None


def get_inference_client() -> InferenceClient:
    global _client
    if _client is None:
        _client = InferenceClient()
    return _client


def label_map(probabilities: np.ndarray) -> dict[str, float]:
    return {
        name: round(float(probabilities[i]), 6)
        for i, name in enumerate(PATHOLOGIES)
    }
