# SENTINEL-CXR

**Uncertainty-Aware Chest Radiograph Triage** — a deep learning system that produces
prediction sets with a statistical coverage guarantee, and abstains when it cannot
meet it.

> **Research prototype. Not a medical device. Must not be used for clinical decisions.**

Final Group Project · Deep Learning (MAIB AI 114) · Prof Anshul Gupta
S P Jain School of Global Management, Dubai

| Group member | Student ID |
|---|---|
| Krishna Mathur | AS25DXB018 |
| Atharva Soundankar | AS25DXB020 |
| Yash Petkar | AS25DXB021 |

---

## The idea

Most medical deep learning fails to reach deployment not because it is insufficiently
accurate, but because it is confident about everything — including images outside its
training distribution and cases where the evidence does not support a decision. A
fluent, confident, wrong answer is more dangerous in a clinical workflow than no
answer at all.

SENTINEL-CXR inverts that. It defends against unearned confidence in three layers:

1. **A variational autoencoder gate** rejects anything that is not a chest radiograph,
   before classification runs.
2. **Uncertainty decomposition** separates the model's own ignorance (epistemic) from
   irreducible ambiguity in the image (aleatoric). Only the former justifies abstention.
3. **Split conformal prediction** converts uncalibrated scores into sets with
   distribution-free, finite-sample marginal coverage. If the set is empty or
   implausibly large, the system abstains and routes the study to a radiologist.

---

## Repository layout

```
apps/web/              Next.js 15 frontend            → Vercel
apps/api/              FastAPI orchestrator, 512 MB   → Render
services/inference/    PyTorch inference core, 16 GB  → Hugging Face Spaces
notebooks/             11 Colab notebooks, one per syllabus topic
deliverables/          Academic report (.docx) and two decks (.pptx)
docs/                  Spec, deployment guide, model card, prompt pack
scripts/               Generators for the notebooks, report and decks
```

## Architecture

Render's free tier provides **512 MB and 0.1 CPU**. PyTorch does not fit. Hugging Face
Spaces provides **16 GB**. The whole design follows from that asymmetry.

```
Vercel      Next.js 15 — landing + clinical console
   │        HTTPS + JWT
Render      FastAPI · 512 MB · NO PyTorch
   │        conformal head (NumPy) · auth · audit log
   ├── cold ─→ ONNX int8 · <900 ms · response marked "reduced"
   │
HF Spaces   16 GB · DenseNet · ViT · VAE · LSTM · Grad-CAM
   │
Supabase    Postgres + object storage
```

A free Space sleeps after 48 hours and takes ~40 s to wake. When it is cold, the ONNX
fast path answers immediately and the response is marked `reduced` — visibly, in the
interface. Degradation is never silent: a clinical user must know which mode produced
the result in front of them.

---

## Running it locally

Requires Python 3.11+ and Node 20+.

**1. Inference core** (downloads pretrained weights on first run, ~30 MB)

```bash
cd services/inference
pip install -r requirements.txt
uvicorn app:app --port 7860
```

**2. Orchestrator** — works with no configuration at all, using SQLite and template
reports.

```bash
cd apps/api
pip install -r requirements.txt
INFERENCE_URL=http://localhost:7860 uvicorn app.main:app --port 8000
```

**3. Frontend**

```bash
cd apps/web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev          # http://localhost:3000
```

Copy `.env.example` to `.env` to add Supabase, Gemini or a deployed inference URL.
Everything is optional — the system degrades to documented defaults rather than
failing.

## Tests

```bash
cd apps/api && pytest -q          # 80 tests
cd apps/web && npm run build
python scripts/build_notebooks.py # regenerate + validate notebooks
```

The suite covers the conformal coverage guarantee, the aleatoric/epistemic split,
triage ordering, progression logic, adversarial report grounding, and the full API
surface. CI additionally gates on coverage not regressing and on no pathology
escaping the grounding filter.

---

## Weight provenance

The deployed demonstration loads `densenet121-res224-nih` from
[TorchXRayVision](https://github.com/mlmed/torchxrayvision) (Cohen et al.) so the live
system is functional from day one. The notebooks reproduce and extend these models;
group-trained weights drop in via `CLASSIFIER_WEIGHTS`.

Whatever is loaded is reported by `/health` and in the API response.
**No result produced by borrowed weights is presented as our own training outcome.**

Two consequences of using a published checkpoint, both surfaced rather than hidden:

- It contains **no dropout layers**, so Monte-Carlo dropout would report an epistemic
  uncertainty of exactly zero. The service falls back to **test-time augmentation** and
  labels which method produced each estimate.
- The **VAE gate is untrained** until `notebooks/06_vae_ood.ipynb` has been run and
  `weights/vae.pth` deployed. `/health` says so, and the score is not used for
  rejection until then.

## Syllabus coverage

| Wk | Topic | Where it lives | Notebook |
|---|---|---|---|
| 1–2 | NN, activations, backprop | From-scratch NumPy backprop, gradient check | `01` |
| 3 | CNNs | DenseNet-121 classifier + conformal calibration | `02` |
| 4 | RNNs | GRU over patient follow-up sequences | `03` |
| 5 | LSTM | RNN/GRU/LSTM ablation, gradient-flow analysis | `04` |
| 6 | GANs | DCGAN minority-class augmentation | `05` |
| 7 | Autoencoders / VAEs | The out-of-distribution gate | `06` |
| 8 | Transfer learning | Scratch / frozen / full / progressive | `07` |
| 9 | Deep RL | Double DQN worklist triage | `08` |
| 10 | ViT / CLIP | CNN vs Transformer, BiomedCLIP zero-shot | `09` |
| 11 | GenAI integration | Grounded report generation + verifier | `10` |
| 12 | Ethics & fairness | Disaggregated audit, shortcut probe, model card | `11` |

## Data

**NIH ChestX-ray14** — 112,120 frontal radiographs, 30,805 patients, 14 pathologies.
[Kaggle](https://www.kaggle.com/datasets/nih-chest-xrays/data) · already de-identified.

Splits are **by `Patient ID`, never by image**. The dataset averages 3–4 studies per
patient, so splitting by image places a patient's follow-up scans on both sides of the
boundary — the model memorises the patient and every metric inflates. The split
asserts disjointness programmatically.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Summary: push this repo, connect it as
a Render Blueprint, duplicate `services/inference/` into a Hugging Face Space, and
import `apps/web` into Vercel. All three tiers are free.

## Documents

- [Design specification](docs/specs/2026-08-12-sentinel-cxr-design.md)
- [Model card](docs/MODEL_CARD.md) — intended use, limitations, fairness
- [Deployment guide](docs/DEPLOYMENT.md)
- [Prompt pack](docs/MASTER_PROMPT.md) — rebuild this system from scratch
- Report and decks: `deliverables/`

## Licence

MIT for the code. The NIH ChestX-ray14 dataset is governed by its own terms.

---

*Built for the Deep Learning unit at S P Jain. Every surface of this system states
that it is not a medical device, because it is not one.*
