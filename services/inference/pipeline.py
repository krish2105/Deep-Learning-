"""Weight loading, Grad-CAM, and the inference pipeline.

Runs on Hugging Face Spaces free CPU hardware: 2 vCPU, 16 GB RAM. Memory is
plentiful here, compute is not, so the design optimises for a small number of
forward passes rather than for a small model.

Classifier weights come from TorchXRayVision (Cohen et al.), which publishes
DenseNet-121 models trained on ChestX-ray14 and related corpora. This makes the
deployed demo functional from day one. Group-trained weights from the notebooks
drop in by setting `CLASSIFIER_WEIGHTS` to a checkpoint path — the provenance
of whatever is loaded is reported in `/health` and never obscured.
"""

from __future__ import annotations

import io
import logging
import os
import time
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from models import ConvVAE, ProgressionRNN, enable_mc_dropout

log = logging.getLogger(__name__)

# Canonical order — must match apps/api/app/core/pathologies.py exactly. If
# these drift, every score is silently attached to the wrong disease.
PATHOLOGIES = (
    "Atelectasis", "Cardiomegaly", "Consolidation", "Edema", "Effusion",
    "Emphysema", "Fibrosis", "Hernia", "Infiltration", "Mass", "Nodule",
    "Pleural_Thickening", "Pneumonia", "Pneumothorax",
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MC_SAMPLES = int(os.getenv("MC_SAMPLES", "20"))
VAE_WEIGHTS = os.getenv("VAE_WEIGHTS", "weights/vae.pth")
RNN_WEIGHTS = os.getenv("RNN_WEIGHTS", "weights/progression.pth")
CLASSIFIER_WEIGHTS = os.getenv("CLASSIFIER_WEIGHTS", "")


@dataclass
class AnalysisOutput:
    probabilities: list[float]
    mc_samples: list[list[float]] | None = None
    ood_score: float = 0.0
    gradcam: dict[str, str] = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)
    backend: str = ""
    latency_ms: int = 0


class GradCAM:
    """Class-activation mapping over the last convolutional block.

    Gradients of a target score with respect to the final feature maps are
    global-average-pooled into per-channel weights; the weighted sum of feature
    maps, passed through ReLU, localises the evidence.

    A necessary caveat, stated in the report and on the UI: Grad-CAM shows
    where activation correlates with the score. It is not a causal explanation,
    and a plausible-looking heat map is not evidence of correct reasoning.
    """

    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module) -> None:
        self.model = model
        self.activations: torch.Tensor | None = None
        self.gradients: torch.Tensor | None = None
        self._handles = [
            target_layer.register_forward_hook(self._save_activation),
            target_layer.register_full_backward_hook(self._save_gradient),
        ]

    def _save_activation(self, _module, _inp, out):
        self.activations = out.detach()

    def _save_gradient(self, _module, _grad_in, grad_out):
        self.gradients = grad_out[0].detach()

    def __call__(self, x: torch.Tensor, class_idx: int) -> np.ndarray:
        self.model.zero_grad(set_to_none=True)
        output = self.model(x)
        output[0, class_idx].backward(retain_graph=True)

        if self.activations is None or self.gradients is None:
            raise RuntimeError("Grad-CAM hooks did not fire; check the target layer.")

        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam = F.relu((weights * self.activations).sum(dim=1, keepdim=True))
        cam = F.interpolate(
            cam, size=x.shape[-2:], mode="bilinear", align_corners=False
        )
        cam = cam.squeeze().cpu().numpy()

        span = cam.max() - cam.min()
        # A flat map means no localised evidence. Normalising it would amplify
        # numerical noise into a confident-looking blob, so return zeros.
        return (cam - cam.min()) / span if span > 1e-8 else np.zeros_like(cam)

    def close(self) -> None:
        for handle in self._handles:
            handle.remove()


def cam_to_png(cam: np.ndarray, size: int = 224) -> str:
    """Encode a heat map as a base64 PNG with alpha.

    Colour is applied only inside the overlay, never to the radiograph itself —
    the interface keeps the image achromatic because a colour cast over a
    diagnostic image is clinically wrong.
    """
    import base64  # noqa: PLC0415

    cam_img = Image.fromarray((cam * 255).astype(np.uint8)).resize(
        (size, size), Image.BILINEAR
    )
    a = np.asarray(cam_img, dtype=np.float32) / 255.0

    # Instrument cyan -> amber -> red, matching the frontend's uncertainty axis.
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[..., 0] = np.clip(255 * np.clip(a * 2 - 0.4, 0, 1), 0, 255)
    rgba[..., 1] = np.clip(255 * np.clip(1.6 - abs(a - 0.55) * 3.2, 0, 1), 0, 255)
    rgba[..., 2] = np.clip(255 * np.clip(1.0 - a * 2.2, 0, 1), 0, 255)
    rgba[..., 3] = (np.clip(a - 0.25, 0, 1) / 0.75 * 210).astype(np.uint8)

    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


class InferencePipeline:
    """Loads models once and serves them. Constructed at application startup."""

    def __init__(self) -> None:
        self.classifier = None
        self.classifier_source = "none"
        self.vae: ConvVAE | None = None
        self.rnn: ProgressionRNN | None = None
        self.target_layer = None
        self.xrv_pathologies: list[str] = []
        self._load()

    # ── loading ──────────────────────────────────────────────────────────
    def _load(self) -> None:
        try:
            import torchxrayvision as xrv  # noqa: PLC0415

            self.classifier = xrv.models.DenseNet(weights="densenet121-res224-nih")
            self.classifier.eval().to(DEVICE)
            self.xrv_pathologies = list(self.classifier.pathologies)
            self.classifier_source = "torchxrayvision:densenet121-res224-nih"
            self.target_layer = self.classifier.features.denseblock4
            log.info("Classifier loaded: %s", self.classifier_source)
        except Exception as exc:  # noqa: BLE001
            log.error("Could not load classifier: %s", exc)

        if CLASSIFIER_WEIGHTS and os.path.exists(CLASSIFIER_WEIGHTS):
            try:
                state = torch.load(CLASSIFIER_WEIGHTS, map_location=DEVICE)
                self.classifier.load_state_dict(state, strict=False)
                self.classifier_source = f"group-trained:{CLASSIFIER_WEIGHTS}"
                log.info("Overrode classifier with %s", CLASSIFIER_WEIGHTS)
            except Exception as exc:  # noqa: BLE001
                log.error("Group weights failed to load, keeping pretrained: %s", exc)

        self.vae = ConvVAE().to(DEVICE).eval()
        if os.path.exists(VAE_WEIGHTS):
            try:
                self.vae.load_state_dict(torch.load(VAE_WEIGHTS, map_location=DEVICE))
                log.info("VAE loaded from %s", VAE_WEIGHTS)
            except Exception as exc:  # noqa: BLE001
                log.warning("VAE weights failed to load: %s", exc)
        else:
            # An untrained VAE cannot separate distributions. Say so, and let
            # the caller disable the gate rather than trust a meaningless score.
            log.warning(
                "No VAE weights at %s. The OOD gate is UNTRAINED and its score "
                "must not be used for rejection until 06_vae_ood.ipynb has run.",
                VAE_WEIGHTS,
            )

        self.rnn = ProgressionRNN(cell="lstm").to(DEVICE).eval()
        if os.path.exists(RNN_WEIGHTS):
            try:
                self.rnn.load_state_dict(torch.load(RNN_WEIGHTS, map_location=DEVICE))
                log.info("Progression RNN loaded from %s", RNN_WEIGHTS)
            except Exception as exc:  # noqa: BLE001
                log.warning("RNN weights failed to load: %s", exc)

    @property
    def vae_trained(self) -> bool:
        return os.path.exists(VAE_WEIGHTS)

    # ── preprocessing ────────────────────────────────────────────────────
    @staticmethod
    def _to_tensor(image_bytes: bytes, size: int = 224) -> torch.Tensor:
        """TorchXRayVision expects greyscale scaled to [-1024, 1024]."""
        img = Image.open(io.BytesIO(image_bytes)).convert("L").resize(
            (size, size), Image.BILINEAR
        )
        arr = np.asarray(img, dtype=np.float32)
        arr = (arr / 255.0) * 2048.0 - 1024.0
        return torch.from_numpy(arr)[None, None, :, :].to(DEVICE)

    @staticmethod
    def _to_vae_tensor(image_bytes: bytes, size: int = 128) -> torch.Tensor:
        img = Image.open(io.BytesIO(image_bytes)).convert("L").resize(
            (size, size), Image.BILINEAR
        )
        arr = np.asarray(img, dtype=np.float32) / 255.0
        return torch.from_numpy(arr)[None, None, :, :].to(DEVICE)

    def _reorder(self, scores: np.ndarray) -> np.ndarray:
        """Map TorchXRayVision's label order onto ours.

        Its heads cover a superset in a different order. Position-matching the
        two vectors would silently mislabel every finding, so we map by name and
        leave anything it does not predict at zero.
        """
        out = np.zeros(len(PATHOLOGIES), dtype=np.float64)
        for i, name in enumerate(PATHOLOGIES):
            if name in self.xrv_pathologies:
                out[i] = float(scores[self.xrv_pathologies.index(name)])
        return out

    # ── inference ────────────────────────────────────────────────────────
    @torch.no_grad()
    def _predict(self, x: torch.Tensor) -> np.ndarray:
        return self._reorder(self.classifier(x)[0].cpu().numpy())

    def _mc_dropout(self, x: torch.Tensor, n: int) -> tuple[np.ndarray, str] | None:
        """Posterior samples via MC-dropout, falling back to test-time augmentation.

        The published TorchXRayVision DenseNet contains no dropout layers, so
        MC-dropout would return n identical passes and an epistemic uncertainty
        of exactly zero — a confident claim of certainty that is an artefact of
        the architecture, not a property of the evidence.

        Injecting dropout into a network trained without it is not a valid
        posterior approximation, so instead we fall back to **test-time
        augmentation**: perturb the input with small, clinically plausible
        transforms and treat the spread of predictions as the uncertainty
        estimate. TTA is an established uncertainty-quantification method and
        makes a real claim — a finding that survives a two-degree rotation is
        more robust than one that does not.

        Which method produced the samples is returned and reported, never
        conflated. Group-trained checkpoints from the notebooks *do* include
        dropout, and this automatically switches back to MC-dropout for them.
        """
        if enable_mc_dropout(self.classifier) > 0:
            with torch.no_grad():
                samples = np.stack([self._predict(x) for _ in range(n)])
            self.classifier.eval()
            return samples, "mc-dropout"

        log.info("No dropout layers; using test-time augmentation for uncertainty")
        samples = [self._predict(x)]
        with torch.no_grad():
            for i in range(1, min(n, 12)):
                angle = float(np.linspace(-3.0, 3.0, min(n, 12))[i])
                shift = int(np.linspace(-5, 5, min(n, 12))[i])
                aug = torch.rot90(x, 0, (2, 3))
                aug = torch.roll(aug, shifts=shift, dims=3)
                if abs(angle) > 0.1:
                    theta = torch.tensor(
                        [[[np.cos(np.radians(angle)), -np.sin(np.radians(angle)), 0.0],
                          [np.sin(np.radians(angle)), np.cos(np.radians(angle)), 0.0]]],
                        dtype=torch.float32, device=x.device,
                    )
                    grid = F.affine_grid(theta, aug.shape, align_corners=False)
                    aug = F.grid_sample(aug, grid, align_corners=False, padding_mode="border")
                samples.append(self._predict(aug))
        return np.stack(samples), "test-time-augmentation"

    def analyze(self, image_bytes: bytes, want_gradcam: bool = True) -> AnalysisOutput:
        started = time.perf_counter()
        if self.classifier is None:
            raise RuntimeError("No classifier is loaded.")

        x = self._to_tensor(image_bytes)
        probs = self._predict(x)

        ood_score = 0.0
        if self.vae is not None and self.vae_trained:
            ood_score = float(
                self.vae.reconstruction_error(self._to_vae_tensor(image_bytes))[0]
            )

        sampled = self._mc_dropout(x, MC_SAMPLES)
        samples, uncertainty_method = (
            sampled if sampled is not None else (None, "none")
        )

        gradcam: dict[str, str] = {}
        if want_gradcam and self.target_layer is not None:
            gradcam = self._gradcam_for_top(x, probs)

        embedding: list[float] = []
        try:
            with torch.no_grad():
                feats = self.classifier.features(x)
                embedding = (
                    F.adaptive_avg_pool2d(F.relu(feats), 1)
                    .flatten()
                    .cpu()
                    .numpy()
                    .tolist()
                )
        except Exception as exc:  # noqa: BLE001
            log.debug("Embedding extraction unavailable: %s", exc)

        return AnalysisOutput(
            probabilities=probs.tolist(),
            mc_samples=samples.tolist() if samples is not None else None,
            ood_score=ood_score,
            gradcam=gradcam,
            embedding=embedding,
            backend=f"{self.classifier_source} · uncertainty={uncertainty_method}",
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    def _gradcam_for_top(
        self, x: torch.Tensor, probs: np.ndarray, top_k: int = 3
    ) -> dict[str, str]:
        """Heat maps for the highest-scoring findings only.

        Computing all fourteen costs fourteen backward passes on 0.1-2 vCPU for
        maps nobody looks at.
        """
        out: dict[str, str] = {}
        order = np.argsort(probs)[::-1][:top_k]
        cam = GradCAM(self.classifier, self.target_layer)
        try:
            for idx in order:
                name = PATHOLOGIES[idx]
                if name not in self.xrv_pathologies or probs[idx] < 0.20:
                    continue
                xrv_idx = self.xrv_pathologies.index(name)
                x_grad = x.clone().requires_grad_(True)
                try:
                    out[name] = cam_to_png(cam(x_grad, xrv_idx))
                except RuntimeError as exc:
                    log.warning("Grad-CAM failed for %s: %s", name, exc)
        finally:
            cam.close()
        return out

    def health(self) -> dict:
        return {
            "status": "ok",
            "device": str(DEVICE),
            "classifier": self.classifier_source,
            "vae_trained": self.vae_trained,
            "mc_samples": MC_SAMPLES,
            "pathologies": list(PATHOLOGIES),
            "warnings": (
                []
                if self.vae_trained
                else ["OOD gate untrained — reconstruction score is not meaningful"]
            ),
        }


_pipeline: InferencePipeline | None = None


def get_pipeline() -> InferencePipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = InferencePipeline()
    return _pipeline
