# Model Card — SENTINEL-CXR

Following Mitchell et al. (2019), *Model Cards for Model Reporting*.

**Version** 1.0.0 · 12 August 2026
**Owners** Krishna Mathur (AS25DXB018), Atharva Soundankar (AS25DXB020), Yash Petkar (AS25DXB021)
**Context** Deep Learning (MAIB AI 114), S P Jain School of Global Management, Dubai
**Licence** MIT (code). NIH ChestX-ray14 governed by its own terms.

---

## 1. Intended use

**Intended:** demonstrating uncertainty-aware triage and selective prediction on chest
radiographs, as coursework and as a reference implementation of conformal abstention
in an applied pipeline.

**Not intended, under any circumstance:**

- Diagnosis, screening, or any input to patient care
- Prioritising real clinical worklists
- Any use on identifiable patient data
- Any deployment implying regulatory clearance — there is none

This system has no regulatory approval of any kind and has never been evaluated
prospectively.

## 2. Users

The intended user is a student, researcher, or educator examining the system. There is
no intended clinical user, because the system is not fit for clinical use.

---

## 3. Components

| Component | Architecture | Purpose |
|---|---|---|
| Classifier | DenseNet-121, 14 sigmoid outputs | Multi-label pathology scoring |
| OOD gate | Convolutional VAE, 128-d latent | Reject non-radiographs |
| Uncertainty | MC-dropout, or TTA when dropout is absent | Aleatoric / epistemic split |
| Conformal head | Split conformal, per-label | Prediction sets with coverage |
| Progression | GRU / LSTM with masked attention | Change across prior studies |
| Triage | Double DQN, linear head exported | Worklist ordering |
| Explanation | Grad-CAM on `denseblock4` | Spatial attribution |
| Reporting | Gemini 2.5 Flash-Lite, verified | Draft findings and impression |

### Weight provenance

The deployed demonstration uses `densenet121-res224-nih` from TorchXRayVision (Cohen
et al.). This is stated in the README, this card, the API `/health` response, and every
analysis response. **No result produced by these weights is presented as our own
training outcome.**

Two consequences, surfaced rather than hidden:

- The published checkpoint contains **no dropout layers**. Monte-Carlo dropout would
  therefore report epistemic uncertainty of exactly zero — a claim of certainty that is
  an artefact of architecture. The service falls back to **test-time augmentation** and
  reports which method produced each estimate.
- The **VAE gate is untrained** until `06_vae_ood.ipynb` has been run and its weights
  deployed. `/health` reports this and the score is not used for rejection until then.

---

## 4. Training data

**NIH ChestX-ray14** — 112,120 frontal radiographs, 30,805 patients, 14 labels, from
the NIH Clinical Center. Already de-identified.

- Splits are **patient-disjoint** 70 / 10 / 20, asserted programmatically.
- The 10% calibration split is used only for conformal thresholds; reusing training
  data would void the exchangeability assumption and with it the guarantee.
- Labels were NLP-mined from radiology reports with **~10% reported error**.
- Class prevalence spans roughly 0.3% (Hernia) to 18% (Infiltration).

---

## 5. Evaluation

| Claim | Metric | Gate |
|---|---|---|
| Discrimination | AUROC per pathology, macro | CI fails on regression |
| Rare classes | Average precision | Reported per class |
| Coverage | Empirical vs nominal 1−α | Asserted in CI |
| OOD gating | AUROC, radiograph vs non-radiograph | Threshold at 1% FPR |
| Progression | Macro AUROC vs persistence baseline | Must exceed baseline |
| Triage | Episodic return vs FIFO / heuristic / oracle | Must exceed heuristic |
| Fairness | Equalised-odds gap | Below 0.10 |
| Grounding | Ungrounded-finding rate | Zero post-filter, by construction |

Accuracy is deliberately **not** reported. At 1% prevalence a model that always
predicts absence scores 99%.

### Verified results

| Measurement | Result |
|---|---|
| Conformal implementation, macro empirical coverage | 0.9004 against 0.90 nominal |
| Backpropagation gradient check, max relative error | 7.2 × 10⁻¹¹ |
| Triage: urgency heuristic vs FIFO | −397.7 vs −841.7 mean return |
| Gradient survival at t=0, gated vs vanilla RNN | ~4 orders of magnitude |
| Automated tests | 80 passing |

Full-dataset classification and fairness figures require the complete training run and
are left explicitly blank rather than estimated.

---

## 6. Fairness

**Audited strata:** patient sex, age band (<30, 30–50, 50–70, 70+), view position
(AP / PA). Reported as equalised-odds gaps — the maximum within-stratum difference in
true-positive and false-positive rate. Equal accuracy is not sufficient: a model can be
equally accurate across two groups while missing considerably more disease in one.

**The view-position confound.** Anteroposterior films are acquired at the bedside from
patients too unwell to stand. View position therefore correlates with severity, and a
model can learn to read "AP film" as "sick patient" — a shortcut that scores well
in-distribution and fails when acquisition practice changes. We probe this directly.

**What cannot be audited.** ChestX-ray14 contains **no race or ethnicity labels**. A
major documented axis of disparity in medical AI is therefore invisible here.
Seyyed-Kalantari et al. (2021) found systematic underdiagnosis by chest radiograph
classifiers in under-served populations, so this is not hypothetical.

> This absence is a finding. It is not, and must not be presented as, an absence of bias.

---

## 7. Limitations

- **Label noise (~10%)** caps every metric reported.
- **Single institution, single country.** Generalisation is unvalidated.
- **Marginal, not simultaneous, coverage.** The guarantee is per label; joint coverage
  across all fourteen would require a multiplicity correction and is not claimed.
- **Exchangeability required.** Distribution shift voids the guarantee, and the system
  cannot detect such shift beyond the OOD gate.
- **Grad-CAM is correlational**, not causal. A plausible heat map is not evidence of
  correct reasoning.
- **Windowing is approximate** — CSS filters over 8-bit images, not DICOM windowing
  over 12-bit data.
- **Triage results are simulated.** No claim is made about a real reading room.
- **Rate limiting is per-instance**, held in process memory. Adequate for one free
  dyno; not a production control.

---

## 8. Ethical considerations

**Automation bias** is the principal hazard. Clinicians are measurably less likely to
override a confident machine judgement, so a confident wrong answer causes more harm
than silence. This is the direct justification for abstention.

**Foreseeable misuse:** deployment as a screening tool in a resource-constrained
setting, on the argument that an imperfect system beats none. We reject that argument.
An unvalidated system with unknown subgroup performance can concentrate harm on
precisely the populations such a deployment claims to serve.

**Mitigations in the system:** abstention rather than forced prediction; distributional
rejection before classification; uncertainty surfaced in the interface rather than
buried; a report writer that cannot introduce an unsupported finding; an append-only
audit log covering every analysis, abstention, rejection, review and rejected
generation; and a persistent non-diagnostic notice on every surface.

**Privacy:** the dataset is de-identified at source. Patient references in the
application are user-supplied pseudonyms, and the interface instructs users never to
enter a real identifier.

---

## 9. Reproducibility

Seed 20260812 throughout. Notebooks run on Colab free tier (T4); no paid runtime is
required. Splits assert patient disjointness at load time. Eighty automated tests cover
the conformal head, uncertainty decomposition, triage ordering, progression logic,
grounding verification and the API surface.

Repository: `github.com/krish2105/Deep-Learning-`

---

## 10. Citation

```bibtex
@misc{sentinel-cxr-2026,
  title  = {SENTINEL-CXR: Uncertainty-Aware Chest Radiograph Triage},
  author = {Mathur, Krishna and Soundankar, Atharva and Petkar, Yash},
  year   = {2026},
  note   = {Deep Learning (MAIB AI 114), S P Jain School of Global Management, Dubai},
  url    = {https://github.com/krish2105/Deep-Learning-}
}
```
