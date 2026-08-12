---
title: SENTINEL-CXR Inference Core
emoji: 🫁
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# SENTINEL-CXR — Inference Core

DenseNet-121 chest radiograph classification, VAE out-of-distribution gating,
uncertainty estimation, and Grad-CAM. Serves the orchestration API.

**Research prototype for MAIB AI 114. Not a medical device.**

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Loaded weights, device, warnings |
| `POST /analyze` | `file` (image), `gradcam` (bool) → scores, samples, CAMs |

## Weight provenance

Classification weights are `densenet121-res224-nih` from
[TorchXRayVision](https://github.com/mlmed/torchxrayvision) (Cohen et al.), so
this Space is functional without a training run. Group-trained weights override
them via `CLASSIFIER_WEIGHTS`. Whatever is loaded is reported by `/health`.

## Notes

- The VAE gate is **untrained** until `weights/vae.pth` is present. `/health`
  reports this, and its score must not be used for rejection until then.
- The pretrained checkpoint has no dropout layers, so uncertainty falls back to
  test-time augmentation. The method used is returned in every response.
