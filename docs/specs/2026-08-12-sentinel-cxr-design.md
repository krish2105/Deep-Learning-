# SENTINEL-CXR — Design Specification

**Uncertainty-Aware Chest Radiograph Triage**

| Field | Value |
|---|---|
| Unit | Deep Learning (MAIB AI 114) |
| Institution | S P Jain School of Global Management, Dubai |
| Faculty | Prof Anshul Gupta |
| Term | MAIB Sept 25, Term 3 |
| Assessment | Final Group Project (30%) + Week 6 Group Project & Presentation (10%) |
| Date | 12 August 2026 |

**Group members**

| Name | Student ID |
|---|---|
| Krishna Mathur | AS25DXB018 |
| Atharva Soundankar | AS25DXB020 |
| Yash Petkar | AS25DXB021 |

---

## 1. Thesis

Most deep-learning diagnostic systems emit a confident probability for every input — including inputs they have never seen, images that are not radiographs at all, and cases where the evidence genuinely does not support a decision. This is the central obstacle to clinical deployment: not accuracy, but *unearned confidence*.

SENTINEL-CXR is a chest-radiograph triage system built around the opposite commitment. It produces a **prediction set with a statistical coverage guarantee**, and when it cannot meet that guarantee it **abstains** and routes the study to a human radiologist.

The system defends against unearned confidence in three layers:

1. **Distributional gate** — a convolutional variational autoencoder scores reconstruction error to decide whether the input is a chest radiograph at all. Non-radiographs are rejected before classification.
2. **Epistemic uncertainty** — Monte-Carlo dropout and a deep ensemble estimate how much of the model's uncertainty comes from the model itself rather than the data.
3. **Conformal prediction** — a calibrated nonconformity threshold converts scores into a prediction set with a user-chosen coverage level (default 90%). If the set is empty or implausibly large, the system abstains.

The measurable claim: **on a held-out test split, empirical coverage of the conformal prediction set falls within tolerance of the nominal level, and the abstention mechanism measurably reduces error on the cases it accepts.** That claim is testable, and the evaluation suite tests it in CI.

---

## 2. Scope and non-goals

### In scope
- Multi-label classification of 14 thoracic pathologies from frontal chest radiographs.
- Longitudinal progression modelling across a patient's prior studies.
- Visual explanation via Grad-CAM.
- Out-of-distribution rejection.
- Conformal prediction sets with abstention.
- Reinforcement-learning triage ordering of the radiologist worklist.
- Fairness audit across age, sex, and view position.
- Grounded natural-language draft reports.
- A deployed web application with authentication and case history.

### Explicit non-goals
- **This is not a medical device.** No clinical claim is made, and the system must never be used for real diagnosis. Every surface in the application states this.
- No segmentation, no 3D/CT, no DICOM PACS integration.
- No patient-identifiable data. The NIH dataset is already de-identified; no other patient data enters the system.
- No claim of radiologist-level performance.

---

## 3. Syllabus coverage

The unit spans twelve topics. The system covers all twelve within one coherent architecture rather than as disconnected exercises.

| Wk | Syllabus topic | Realisation in SENTINEL-CXR | Artefact |
|---|---|---|---|
| 1–2 | Neural networks, activations, backpropagation | Backpropagation implemented from scratch in NumPy; activation and optimiser ablation on a baseline MLP | `01_foundations.ipynb` |
| 3 | Convolutional neural networks | DenseNet-121 multi-label classifier; convolution/pooling feature-map visualisation | `02_cnn_classifier.ipynb` |
| 4 | Recurrent neural networks | GRU over per-visit CNN embeddings to forecast pathology progression | `03_rnn_progression.ipynb` |
| 5 | Long short-term memory | BiLSTM vs GRU vs vanilla RNN ablation on patient timelines | `04_lstm_ablation.ipynb` |
| 6 | Generative adversarial networks | DCGAN synthesises minority-class radiographs; measured Δ AUC on rare pathologies | `05_gan_augmentation.ipynb` |
| 7 | Autoencoders and VAEs | Convolutional VAE for OOD rejection; latent-space traversal and visualisation | `06_vae_ood.ipynb` |
| 8 | Transfer learning | ImageNet→CXR fine-tuning; frozen vs progressive unfreezing; DINOv2 comparison | `07_transfer_learning.ipynb` |
| 9 | Deep reinforcement learning | DQN agent orders the worklist to minimise time-to-diagnosis for critical findings | `08_dqn_triage.ipynb` |
| 10 | Practical applications (ViT, CLIP) | ViT-B/16 branch; CNN vs Transformer head-to-head; BiomedCLIP zero-shot baseline | `09_vit_clip.ipynb` |
| 11 | Generative AI integration | GAN+VAE augmentation feeding the classifier; LLM drafts reports grounded in model output | `10_genai_integration.ipynb` |
| 12 | Ethics and societal impact | Bias audit by age/sex/view; equalised-odds analysis; abstention as safety mechanism; model card | `11_fairness_ethics.ipynb` |

Mapping to assessed unit learning outcomes:

| Outcome | Where it is demonstrated |
|---|---|
| A — Describe principles of deep learning and neural networks | Report §2–3; `01_foundations.ipynb` |
| B — Evaluate performance of diverse deep learning models | The ablation suite: CNN vs ViT, RNN vs GRU vs LSTM, frozen vs unfrozen |
| C — Apply deep learning to real-world problems | The deployed application |
| D — Integrate generative AI with deep learning | GAN augmentation, VAE gating, grounded LLM reporting |
| E — Examine ethical and societal impacts | §9 of this spec, `11_fairness_ethics.ipynb`, model card |

Outcome E is assessed **only** in the Final Group Project. The fairness audit is therefore a graded requirement, not an optional extension.

---

## 4. Data

**Primary dataset — NIH ChestX-ray14.** 112,120 frontal-view radiographs from 30,805 unique patients, labelled for 14 thoracic pathologies. Publicly released by the NIH Clinical Center; already de-identified.

The metadata file `Data_Entry_2017.csv` carries the fields that make this project possible:

| Field | Used for |
|---|---|
| `Image Index` | Join key |
| `Finding Labels` | Multi-label target (14 pathologies, pipe-delimited) |
| `Follow-up #` | **Sequence position for the RNN/LSTM branch** |
| `Patient ID` | **Groups studies into patient timelines** |
| `Patient Age`, `Patient Gender` | **Fairness audit strata** |
| `View Position` | Fairness audit stratum (AP vs PA) |

Because the dataset averages 3–4 images per patient, `Patient ID` + `Follow-up #` yields genuine longitudinal sequences. This is what allows the recurrent branch to be clinically meaningful rather than a bolted-on syllabus exercise.

**Splitting is by `Patient ID`, never by image.** Splitting by image would place a patient's follow-up scans on both sides of the split and leak information, inflating every metric. This is the most common methodological error in published work on this dataset, and avoiding it is a defensible point in the report.

**Known label noise.** ChestX-ray14 labels were mined from radiology reports by NLP, with reported error rates around 10%. The report states this as a limitation and it bounds the credible accuracy claim.

**Secondary data.** A small set of non-radiograph images (natural photographs) is used solely to validate the VAE out-of-distribution gate.

---

## 5. Architecture

### 5.1 Constraint that drives the design

Render's free tier provides **512 MB RAM and 0.1 CPU**, and spins a service down after 15 minutes of inactivity with a 30–60 second cold start. PyTorch alone exceeds that memory budget. Hugging Face Spaces' free tier provides **2 vCPU and 16 GB RAM**, sleeping only after 48 hours.

The architecture follows directly from this asymmetry.

```
┌──────────────────────────────────┐
│  Vercel — Next.js 15 App Router  │   Landing + clinical console
│  TypeScript · Tailwind · Motion  │   light/dark · WCAG AA
└────────────────┬─────────────────┘
                 │ HTTPS + JWT
┌────────────────▼─────────────────┐
│  Render — FastAPI orchestrator   │   512 MB · NO PyTorch
│  auth · rate limit · audit log   │   conformal head (NumPy)
│  ONNX int8 fallback (~12 MB)     │   study CRUD
└────┬─────────────────────┬───────┘
     │                     │ heavy inference
     │        ┌────────────▼──────────────┐
     │        │  HF Spaces — model core   │  16 GB · full PyTorch
     │        │  DenseNet · ViT · VAE     │  Grad-CAM · MC-dropout
     │        │  LSTM · GAN sampler       │
     │        └───────────────────────────┘
┌────▼──────────────────────────────┐
│  Supabase Postgres + Storage      │  permanent free tier
└───────────────────────────────────┘
     │
┌────▼──────────────────────────────┐
│  Gemini 2.5 Flash-Lite (optional) │  grounded report drafting
└───────────────────────────────────┘
```

Render's own free Postgres expires after 30 days, so Supabase is used instead — the deployment must still work when the project is graded.

### 5.2 Graceful degradation

Because HF Spaces sleeps after 48 hours, a cold Space would otherwise mean a 40-second wait on the grader's first click. The orchestrator therefore runs **two inference paths**:

| Path | Contents | Latency | When used |
|---|---|---|---|
| **Full** | DenseNet + ViT ensemble, MC-dropout, Grad-CAM, LSTM, VAE | 2–6 s warm | Spaces healthy |
| **Fast** | ONNX int8 DenseNet + VAE on Render | < 900 ms | Spaces cold or unreachable |

On a cold Space the orchestrator returns the fast-path result immediately, marks the response `mode: "reduced"`, wakes the Space in the background, and pushes the full result over SSE when ready. The UI shows a `REDUCED` badge and the Grad-CAM panel resolves in place.

This is a real engineering response to a real constraint, and is documented as such rather than hidden.

### 5.3 Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `services/inference/models/` | Pure model definitions. Tensors in, tensors out. No I/O, no HTTP. | torch |
| `services/inference/pipeline/` | Loads weights, orchestrates VAE→CNN→CAM→LSTM | models |
| `services/inference/app.py` | HTTP surface for the Space | pipeline |
| `apps/api/core/` | Conformal calibration, triage scoring. Pure functions. | numpy |
| `apps/api/routers/` | HTTP, auth, persistence. No ML. | core, db |
| `apps/web/` | Presentation. No business logic. | api (HTTP only) |

The test of these boundaries: the DenseNet backbone can be swapped for ViT without touching `apps/api`, and the API can be tested with the inference service entirely absent.

---

## 6. Inference pipeline

For a single uploaded study:

```
1. Upload            → presigned URL → Supabase Storage
2. VAE OOD gate      → reconstruction error > τ_ood ?  → REJECT, explain, stop
3. Classifier        → DenseNet-121 (+ ViT if full path) → 14 sigmoid scores
4. Uncertainty       → MC-dropout ×20 → per-label mean, variance
5. Conformal head    → nonconformity vs calibration quantile → prediction set
6. Abstention        → set empty or |set| > k_max → ABSTAIN, route to human
7. Grad-CAM          → per-positive-label heat map
8. Progression       → if priors exist → LSTM over visit embeddings → trend
9. Triage            → DQN policy → priority score → worklist position
10. Report           → Gemini, grounded strictly in steps 3–9 → draft impression
11. Persist          → study, findings, audit entry → stream to client
```

**Step 10 is grounded-only.** The language model receives the structured findings, Grad-CAM regions, conformal set, and progression trend, and is instructed to compose a report *from those inputs only*. It is not shown the image and cannot introduce a finding. If the model returns any pathology not present in the structured input, the response is rejected and the deterministic template is used instead. This is validated by a test.

Without a `GEMINI_API_KEY` the system uses the deterministic template renderer and remains fully functional.

---

## 7. Frontend design

### 7.1 Two surfaces, two motion budgets

A diagnostic console should not behave like a marketing site. Scroll-jacking a worklist a clinician uses repeatedly is a usability failure.

| Surface | Job | Motion |
|---|---|---|
| Landing `/` | Communicate the thesis in fifteen seconds | Orchestrated load, pinned scroll, cursor interaction, Lenis smooth scroll |
| Console `/console` | Triage safely and quickly | State transitions and feedback only. No parallax. No Lenis. Keyboard-first. |

### 7.2 Visual thesis

Radiographs are read on grayscale-calibrated monitors; a colour cast over the image is clinically wrong. That constraint becomes the identity:

> **The interface is monochrome. Colour exists only to encode doubt.**

The mechanic is literal — **confidence is chroma**. A prediction chip at 0.97 confidence renders at full saturation. As confidence falls, saturation drains toward neutral. At the conformal abstention threshold the chip is fully achromatic and carries a diagonal hatch, matching the convention for marking a film region non-diagnostic. Certainty is legible across the whole screen without reading a number.

### 7.3 Tokens

```
Dark (primary — reading rooms are dim)
--film-base      #0B0D0E   near-black, faint cool cast
--film-fog       #16191B   panel surface
--film-shoulder  #2A2F33   borders
--film-mid       #8A9299   secondary text
--film-highlight #E8ECEF   primary text
--instrument     #2E9CB8   the chroma axis; desaturates toward --film-mid
--stat           #D64541   critical triage only — clinically mandated

Light (the printed report, not an inversion)
--paper          #F7F8F9
--paper-panel    #FFFFFF
```

The image viewer stays film-dark in **both** themes. A radiograph is never read on white.

**Type:** Bricolage Grotesque (display, landing only, restrained) · IBM Plex Sans (body/UI) · IBM Plex Mono (patient IDs, probabilities, coverage figures — radiology runs on alphanumeric codes, so mono is truthful rather than decorative).

### 7.4 Signature element

**The hot light.** The hero is a single chest radiograph. A circular window follows the cursor and reveals the Grad-CAM overlay within it. Radiologists use a hot light to inspect dense film; here it reveals what the model attends to. The product demonstrates itself with no explanatory copy.

Followed by one pinned scroll section in which a chip's chroma drains as the case becomes harder, resolving into the hatched `ABSTAIN` state — the thesis animated once, then dropped.

### 7.5 Console layout

```
┌──────────┬────────────────────────┬──────────────────┐
│ WORKLIST │        VIEWER          │    FINDINGS      │
│          │                        │                  │
│ ▌STAT    │   ┌──────────────┐     │ ▓▓▓ Effusion .94 │
│  04:12   │   │              │     │ ▒▒░ Nodule   .61 │
│ ─────────│   │  film-dark   │     │ ╱╱╱ ABSTAIN      │
│  ROUTINE │   │  always      │     │ ──────────────── │
│  01:33   │   └──────────────┘     │ priors ╱╲_╱‾     │
│ ─────────│   W/L  ──●──           │ ──────────────── │
│  ROUTINE │   CAM  ──●──           │ draft report     │
│  00:47   │                        │                  │
└──────────┴────────────────────────┴──────────────────┘
  DQN-ordered      window/level +          confidence chips
                   Grad-CAM opacity        + conformal set
```

Interactive tabs across the console: **Overview · Findings · Explainability · Progression · Uncertainty · Fairness · Report · Audit**.

### 7.6 Quality floor

Responsive to 360 px. Visible keyboard focus, logical tab order, real `<button>`/`<a>`. `prefers-reduced-motion` respected globally in CSS and via `useReducedMotion()` in JS; Lenis disabled for reduced-motion users. Only `transform` and `opacity` animate. Contrast ≥ 4.5:1. Semantic heading hierarchy and landmarks.

---

## 8. Error handling

| Failure | Response |
|---|---|
| HF Space cold or down | ONNX fast path, `mode: "reduced"`, background wake, SSE upgrade |
| Input is not a radiograph | Hard reject at VAE gate with plain-language explanation |
| Model uncertain beyond threshold | Abstain, route to human, never guess |
| Gemini 429 / no key | Deterministic template report |
| Gemini introduces unsupported finding | Response rejected, template used, incident logged |
| Upload too large / wrong type | Rejected at the edge with a specific message |
| Database unreachable | Read-only demo mode; analysis still runs, history unavailable |

Errors state what happened and what to do about it. They do not apologise and they are never vague.

---

## 9. Ethics, fairness and limitations

Assessed learning outcome E lives here.

**Fairness audit.** Per-pathology AUC, sensitivity and specificity are computed across strata of `Patient Gender`, `Patient Age` (binned), and `View Position`. Disparities are reported as equalised-odds gaps. Thresholds are set so that CI fails if a retrained model widens a gap beyond tolerance.

**Known risks, stated plainly.**
- ChestX-ray14 labels are NLP-mined with roughly 10% error; every reported metric inherits that ceiling.
- The dataset originates from a single US institution. Performance on other populations and equipment is unvalidated.
- AP and PA views are not clinically equivalent; portable AP films correlate with sicker patients, so view position is a confounder that a model can exploit as a shortcut.
- Grad-CAM shows correlation, not causation. A plausible heat map is not evidence of correct reasoning.
- Automation bias is a genuine deployment hazard: a confident wrong answer is more dangerous than no answer. This is the direct justification for the abstention mechanism.

**Mitigations built into the system.** Abstention rather than forced prediction. OOD rejection. Uncertainty surfaced in the interface rather than buried. A model card shipped with the repository. Grounded-only report generation. A persistent non-diagnostic notice on every surface.

---

## 10. Testing and evaluation

| Layer | Method | Gate |
|---|---|---|
| Model | Held-out patient-disjoint test split | Minimum macro AUC; CI fails on regression |
| Conformal | Empirical coverage vs nominal | Within tolerance band |
| Fairness | Equalised-odds gap per stratum | Below threshold |
| OOD | Non-radiographs vs radiographs | Minimum AUROC on the gate |
| Backend | pytest + httpx; contract tests against the Space | All pass |
| Grounding | Adversarial prompts attempting to induce unsupported findings | Zero leaks |
| Frontend | Playwright on upload→result | Passes |
| Accessibility | axe on landing and console | No serious violations |

Evaluation metrics are chosen for the problem, not for convenience: **AUROC per pathology** (class imbalance makes accuracy meaningless here), **AUPRC** for rare findings, **empirical coverage** for the conformal claim, and **quadratic-weighted agreement** for progression.

---

## 11. Deliverables

| Deliverable | Location |
|---|---|
| Monorepo | `github.com/krish2105/Deep-Learning-` |
| Frontend | `apps/web` → Vercel |
| Orchestrator | `apps/api` → Render |
| Inference service | `services/inference` → HF Spaces |
| Training notebooks (11) | `notebooks/` |
| Academic report (15–20 pp) | `deliverables/report/` |
| Week 6 deck | `deliverables/decks/` |
| Final deck (15 slides) | `deliverables/decks/` |
| Model card | `docs/MODEL_CARD.md` |
| Deployment guide | `docs/DEPLOYMENT.md` |
| Master prompt pack | `docs/MASTER_PROMPT.md` |

---

## 12. Weight provenance

The deployed application ships with pretrained chest-radiograph weights from **TorchXRayVision** (`densenet121-res224-nih`, Cohen et al.), so the live demo is functional from day one. The training notebooks reproduce and extend these models; swapping in group-trained weights is a single configuration change documented in `docs/DEPLOYMENT.md`.

This provenance is stated in the README, the model card, and the report. No result produced by borrowed weights is presented as the group's own training outcome.
