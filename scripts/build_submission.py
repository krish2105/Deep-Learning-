#!/usr/bin/env python3
"""Assemble the submission archive.

Produces a single zip containing everything an examiner needs and nothing they
do not: documents first, then source, then the artefacts that let the results be
reproduced. Build outputs, caches, dependencies and the dataset are excluded —
they are large, regenerable, and would bury the four files that actually get
marked.

Run:  python scripts/build_submission.py
"""

from __future__ import annotations

import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP = datetime.now().strftime("%Y-%m-%d")
OUT = ROOT / f"SENTINEL-CXR_MAIB-AI-114_Group-Submission_{STAMP}.zip"

# Directories that must never enter the archive. node_modules alone is ~300 MB
# and .next is a build output; both regenerate from the manifest.
EXCLUDE_DIRS = {
    ".git", "node_modules", ".next", "__pycache__", ".pytest_cache",
    ".ruff_cache", ".mypy_cache", ".ipynb_checkpoints", ".vercel",
    "hf-space", "venv", ".venv", "data", ".turbo", ".claude",
}
EXCLUDE_SUFFIXES = {".pyc", ".pyo", ".log", ".db", ".zip", ".DS_Store"}
# .env.local is a developer's machine-local config and has no business in a
# submission. .env.production is kept: it holds only the public API URL and is
# committed deliberately so the Vercel build is reproducible.
EXCLUDE_NAMES = {
    ".DS_Store", ".env", ".env.local", "sentinel.db", "package-lock.json",
    "tsconfig.tsbuildinfo", "next-env.d.ts",
}


def include(path: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in path.parts):
        return False
    if path.name in EXCLUDE_NAMES or path.suffix in EXCLUDE_SUFFIXES:
        return False
    # The int8 model is 7.9 MB and IS included: without it the API cannot
    # diagnose, and "clone and run" would be false.
    return True


MANIFEST = """SENTINEL-CXR — Submission contents
Uncertainty-Aware Chest Radiograph Triage

Final Group Project · Deep Learning (MAIB AI 114)
Prof Anshul Gupta · S P Jain School of Global Management, Dubai

  Krishna Mathur       AS25DXB018
  Atharva Soundankar   AS25DXB020
  Yash Petkar          AS25DXB021

════════════════════════════════════════════════════════════════════════
START HERE
════════════════════════════════════════════════════════════════════════

  Live system     https://sentinel-cxr.vercel.app
                  Console -> "Explore the demo". No sign-up required.

  Source code     https://github.com/krish2105/Deep-Learning-

  Report          01_REPORT/SENTINEL-CXR_Report.pdf

Note on the hosting: the API is on a free tier that sleeps after fifteen
minutes, so the very first request may take up to a minute. Everything after
that is immediate. Registered accounts do not survive a restart because the
free tier has no persistent disk, which is why the demo button — which
reissues itself automatically — is the reliable way in. The application
reports both limitations itself rather than hiding them.

════════════════════════════════════════════════════════════════════════
CONTENTS
════════════════════════════════════════════════════════════════════════

01_REPORT/
    SENTINEL-CXR_Report.pdf        The report. 15 pages, 12 tables.
    SENTINEL-CXR_Report.docx       Same document, editable.

02_PRESENTATIONS/
    SENTINEL-CXR_Final.pptx        Final presentation, 15 slides.
    SENTINEL-CXR_Week6_Progress.pptx   Week 6 progress deck, 10 slides.

03_NOTEBOOKS/
    Eleven Colab notebooks, one per syllabus topic, weeks 1-12.
    Runnable on the free tier; no paid runtime required.

04_SOURCE/
    apps/web/                Next.js frontend        -> Vercel
    apps/api/                FastAPI orchestrator    -> Render
    services/inference/      PyTorch inference core  -> Hugging Face Spaces
    scripts/                 Generators for notebooks, report, decks;
                             ONNX export; calibration and fairness audit
    docs/                    Design specification, deployment guide,
                             model card, prompt pack
    README.md                Architecture and how to run it locally

05_ARTEFACTS/
    conformal_calibration.json     Fitted thresholds AND the measured
                                   coverage they achieved
    fairness_report.json           The disaggregated audit
    densenet121_int8.onnx          The deployed classifier, 7.9 MB

════════════════════════════════════════════════════════════════════════
MEASURED RESULTS
════════════════════════════════════════════════════════════════════════

Calibrated on 4,999 real ChestX-ray14 radiographs from 1,335 patients,
split patient-disjointly, scored with the exact weights that serve
production.

  Macro empirical coverage    0.8845   against a 0.90 target — BELOW
  Max equalised-odds gap      0.2149   BREACHES the 0.10 tolerance
  Worst stratum               View position (AP/PA), FPR gap 0.2149
  Inference latency           ~150 ms on 0.1 CPU
  Automated tests             83 passing

Both headline numbers are unfavourable and are reported as measured.

The coverage shortfall follows from patient-disjoint splitting weakening the
exchangeability that conformal prediction assumes, and from thin per-label
calibration sets — Pneumonia has 31 positives, Hernia 7. Raising alpha until
the numbers agreed would be fitting the guarantee to the test set.

The fairness breach confirms the acquisition shortcut predicted in the design
specification before any data was examined. The false-positive gap is 0.2149
while the true-positive gap is only 0.0228: the model is not missing more
disease on portable AP films, it is over-calling it. That asymmetry is the
signature of a shortcut, and aggregate AUROC would not have revealed it.

════════════════════════════════════════════════════════════════════════
PROVENANCE
════════════════════════════════════════════════════════════════════════

The deployed classifier uses TorchXRayVision's published ChestX-ray14
weights (Cohen et al.). This is stated in the report, the model card, the
README, the API health endpoint and every analysis response. No result in
this submission is presented as the outcome of our own training run.

The calibration and fairness artefacts in 05_ARTEFACTS were produced by
scripts/calibrate.py, which runs the deployed model over real data. The
notebooks in 03_NOTEBOOKS document the same pipeline per syllabus topic.

This system is a research prototype. It is not a medical device, has no
regulatory clearance, and must not be used for clinical decisions.
"""


def main() -> None:
    OUT.unlink(missing_ok=True)

    groups: list[tuple[str, list[Path]]] = [
        ("01_REPORT", sorted((ROOT / "deliverables" / "report").glob("*"))),
        ("02_PRESENTATIONS", sorted((ROOT / "deliverables" / "decks").glob("*"))),
        ("03_NOTEBOOKS", sorted((ROOT / "notebooks").glob("*.ipynb"))),
    ]

    source: list[Path] = []
    for sub in ["apps", "services", "scripts", "docs", ".github"]:
        source += [p for p in (ROOT / sub).rglob("*") if p.is_file() and include(p)]
    source += [ROOT / "README.md", ROOT / ".env.example", ROOT / "render.yaml", ROOT / ".gitignore"]

    artefacts = [p for p in (ROOT / "apps" / "api" / "artifacts").glob("*")
                 if p.is_file() and p.suffix in {".json", ".onnx"}]

    n = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("README_FIRST.txt", MANIFEST)
        n += 1

        for folder, files in groups:
            for f in files:
                if f.is_file() and include(f):
                    z.write(f, f"{folder}/{f.name}")
                    n += 1

        for f in source:
            if f.exists() and include(f):
                z.write(f, f"04_SOURCE/{f.relative_to(ROOT)}")
                n += 1

        for f in artefacts:
            z.write(f, f"05_ARTEFACTS/{f.name}")
            n += 1

    size = OUT.stat().st_size / 1e6
    print(f"Wrote {OUT.name}")
    print(f"  {n} files, {size:.1f} MB")

    with zipfile.ZipFile(OUT) as z:
        tops: dict[str, int] = {}
        for name in z.namelist():
            tops[name.split("/")[0]] = tops.get(name.split("/")[0], 0) + 1
        for k in sorted(tops):
            print(f"    {k:24s} {tops[k]:4d} files")


if __name__ == "__main__":
    main()
