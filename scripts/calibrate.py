#!/usr/bin/env python3
"""Fit the conformal calibrator and run the fairness audit on real data.

Produces the two artefacts the deployed system needs before it can honestly
claim anything:

    apps/api/artifacts/conformal_calibration.json   coverage guarantee
    apps/api/artifacts/fairness_report.json         learning outcome E

Runs the committed int8 ONNX model over real ChestX-ray14 images, so the
thresholds are calibrated against exactly the weights that serve production. A
calibrator fitted on a different model than the one deployed would produce a
guarantee that does not hold.

Usage:
    python scripts/calibrate.py --images /tmp/nih/images --limit 5000
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "apps" / "api" / "artifacts"
ONNX = ARTIFACTS / "densenet121_int8.onnx"

PATHOLOGIES = [
    "Atelectasis", "Cardiomegaly", "Consolidation", "Edema", "Effusion",
    "Emphysema", "Fibrosis", "Hernia", "Infiltration", "Mass", "Nodule",
    "Pleural_Thickening", "Pneumonia", "Pneumothorax",
]

ALPHA = 0.10
MAX_SET_SIZE = 6
MIN_CALIBRATION_POSITIVES = 20
FAIRNESS_TOLERANCE = 0.10
SEED = 20260812


# ── data ────────────────────────────────────────────────────────────────
def load_metadata(csv: Path, available: set[str]) -> pd.DataFrame:
    df = pd.read_csv(csv)
    df.columns = [c.strip() for c in df.columns]
    df = df[df["Image Index"].isin(available)].copy()
    for p in PATHOLOGIES:
        df[p] = df["Finding Labels"].str.contains(p, regex=False).astype(int)
    df["Patient Age"] = pd.to_numeric(df["Patient Age"], errors="coerce")
    # Ages above ~100 in this dataset are data-entry errors, not centenarians.
    df = df[(df["Patient Age"] > 0) & (df["Patient Age"] < 100)]
    return df


def patient_disjoint_split(df: pd.DataFrame, fracs=(0.0, 0.5, 0.5), seed=SEED):
    """Split by Patient ID, never by image.

    A patient contributes 3-4 follow-up studies. Splitting by image places the
    same patient on both sides of the boundary, so the model can memorise the
    patient rather than the pathology and every metric inflates. Here we only
    need calibration and test halves; training already happened upstream.
    """
    patients = df["Patient ID"].unique()
    rng = np.random.default_rng(seed)
    rng.shuffle(patients)
    cut = int(fracs[1] * len(patients))
    cal_ids, test_ids = set(patients[:cut]), set(patients[cut:])
    cal = df[df["Patient ID"].isin(cal_ids)].copy()
    test = df[df["Patient ID"].isin(test_ids)].copy()
    assert not (set(cal["Patient ID"]) & set(test["Patient ID"])), "patient leak"
    return cal, test


# ── inference ───────────────────────────────────────────────────────────
def predict_all(df: pd.DataFrame, image_dir: Path) -> np.ndarray:
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(ONNX), opts, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name

    out = np.zeros((len(df), len(PATHOLOGIES)), dtype=np.float64)
    for i, fname in enumerate(df["Image Index"].tolist()):
        img = Image.open(image_dir / fname).convert("L").resize((224, 224), Image.BILINEAR)
        arr = np.asarray(img, dtype=np.float32)
        arr = (arr / 255.0) * 2048.0 - 1024.0
        out[i] = np.asarray(sess.run(None, {name: arr[None, None]})[0]).ravel()
        if (i + 1) % 500 == 0:
            print(f"    {i + 1}/{len(df)}")
    return out


# ── conformal ───────────────────────────────────────────────────────────
def conformal_quantile(scores: np.ndarray, alpha: float) -> float:
    scores = np.asarray(scores, dtype=np.float64)
    n = scores.size
    if n == 0:
        return 1.0
    # The (n+1)/n correction is what makes the guarantee finite-sample exact
    # rather than asymptotic. Omitting it silently under-covers.
    rank = math.ceil((n + 1) * (1.0 - alpha))
    if rank > n:
        return 1.0
    return float(np.sort(scores)[rank - 1])


def fit_conformal(probs: np.ndarray, labels: np.ndarray, alpha=ALPHA):
    thresholds = np.full(len(PATHOLOGIES), 1.0 - 0.5)
    counts = np.zeros(len(PATHOLOGIES), dtype=int)
    for k in range(len(PATHOLOGIES)):
        pos = probs[labels[:, k].astype(bool), k]
        counts[k] = pos.size
        if pos.size < MIN_CALIBRATION_POSITIVES:
            continue
        thresholds[k] = conformal_quantile(1.0 - pos, alpha)
    return thresholds, counts


def empirical_coverage(probs, labels, thresholds) -> dict:
    included = (1.0 - probs) <= thresholds
    out = {}
    for k, name in enumerate(PATHOLOGIES):
        mask = labels[:, k].astype(bool)
        out[name] = float(included[mask, k].mean()) if mask.sum() else float("nan")
    vals = [v for v in out.values() if not math.isnan(v)]
    out["_macro_average"] = float(np.mean(vals)) if vals else float("nan")
    out["_target"] = 1.0 - ALPHA
    return out


# ── fairness ────────────────────────────────────────────────────────────
def fairness_audit(probs, labels, meta: pd.DataFrame, thresholds) -> dict:
    from sklearn.metrics import roc_auc_score

    meta = meta.reset_index(drop=True).copy()
    meta["age_band"] = pd.cut(
        meta["Patient Age"], [0, 30, 50, 70, 100], labels=["<30", "30-50", "50-70", "70+"]
    )
    included = (1.0 - probs) <= thresholds

    rows = []
    for stratum in ["Patient Gender", "age_band", "View Position"]:
        for value, idx in meta.groupby(stratum, observed=True).groups.items():
            idx = np.asarray(idx)
            # Aggregate across labels with enough positives in this stratum.
            tprs, fprs, aucs, n_pos = [], [], [], 0
            for k in range(len(PATHOLOGIES)):
                y = labels[idx, k].astype(bool)
                if y.sum() < 20 or y.sum() == len(y):
                    continue
                pred = included[idx, k]
                tp = int((pred & y).sum()); fn = int((~pred & y).sum())
                fp = int((pred & ~y).sum()); tn = int((~pred & ~y).sum())
                tprs.append(tp / max(tp + fn, 1))
                fprs.append(fp / max(fp + tn, 1))
                try:
                    aucs.append(roc_auc_score(y, probs[idx, k]))
                except ValueError:
                    pass
                n_pos += int(y.sum())
            if not tprs:
                continue
            rows.append({
                "stratum": stratum.replace("Patient ", "").replace("_", " "),
                "value": str(value),
                "n": int(len(idx)),
                "n_positive": n_pos,
                "auc": round(float(np.mean(aucs)) if aucs else float("nan"), 4),
                "tpr": round(float(np.mean(tprs)), 4),
                "fpr": round(float(np.mean(fprs)), 4),
            })

    gaps = []
    df = pd.DataFrame(rows)
    for stratum, g in df.groupby("stratum"):
        gaps.append({
            "stratum": stratum,
            "tpr_gap": round(float(g["tpr"].max() - g["tpr"].min()), 4),
            "fpr_gap": round(float(g["fpr"].max() - g["fpr"].min()), 4),
            "auc_gap": round(float(g["auc"].max() - g["auc"].min()), 4),
        })

    worst = max([max(x["tpr_gap"], x["fpr_gap"]) for x in gaps], default=0.0)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pathology": "macro (averaged over labels with >=20 positives per stratum)",
        "strata": rows,
        "gaps": gaps,
        "max_equalised_odds_gap": round(float(worst), 4),
        "within_tolerance": bool(worst <= FAIRNESS_TOLERANCE),
        "tolerance": FAIRNESS_TOLERANCE,
        "note": (
            "Disparities are reported whether or not they are favourable. A gap "
            "within tolerance is not evidence of fairness, only that this audit "
            "did not detect a violation. ChestX-ray14 carries no race or "
            "ethnicity labels, so a major documented axis of disparity in "
            "medical AI cannot be examined here at all."
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--csv", type=Path, default=Path("/tmp/nih/data/Data_Entry_2017_v2020.csv"))
    ap.add_argument("--limit", type=int, default=5000)
    args = ap.parse_args()

    available = {p.name for p in args.images.glob("*.png")}
    print(f"images found: {len(available):,}")
    df = load_metadata(args.csv, available)
    if args.limit and len(df) > args.limit:
        df = df.sample(args.limit, random_state=SEED)
    print(f"usable rows : {len(df):,} across {df['Patient ID'].nunique():,} patients")

    cal_df, test_df = patient_disjoint_split(df)
    print(f"calibration : {len(cal_df):,}   test: {len(test_df):,}  (patient-disjoint)")

    print("\nrunning the deployed ONNX model over calibration split…")
    cal_probs = predict_all(cal_df, args.images)
    print("running over test split…")
    test_probs = predict_all(test_df, args.images)

    cal_labels = cal_df[PATHOLOGIES].values
    test_labels = test_df[PATHOLOGIES].values

    thresholds, counts = fit_conformal(cal_probs, cal_labels)
    cov = empirical_coverage(test_probs, test_labels, thresholds)

    print("\n── empirical coverage on the held-out test split ──")
    for name in PATHOLOGIES:
        v = cov[name]
        flag = "" if math.isnan(v) or v >= (1 - ALPHA) - 0.05 else "  <-- under"
        print(f"  {name:20s} {('n/a' if math.isnan(v) else f'{v:.4f}'):>7s}  n_cal={counts[PATHOLOGIES.index(name)]:>5d}{flag}")
    print(f"  {'MACRO':20s} {cov['_macro_average']:.4f}   target {cov['_target']:.2f}")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "conformal_calibration.json").write_text(json.dumps({
        "alpha": ALPHA,
        "max_set_size": MAX_SET_SIZE,
        "thresholds": thresholds.tolist(),
        "n_calibration": counts.tolist(),
        "pathologies": PATHOLOGIES,
        "fitted_on": {
            "n_calibration_images": int(len(cal_df)),
            "n_test_images": int(len(test_df)),
            "n_patients": int(df["Patient ID"].nunique()),
            "split": "patient-disjoint 50/50",
            "model": "densenet121_int8.onnx (the deployed weights)",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "empirical_coverage": {k: (None if isinstance(v, float) and math.isnan(v) else v)
                               for k, v in cov.items()},
    }, indent=2))
    print(f"\nWrote {(ARTIFACTS / 'conformal_calibration.json').relative_to(ROOT)}")

    print("\nrunning fairness audit…")
    fair = fairness_audit(test_probs, test_labels, test_df, thresholds)
    (ARTIFACTS / "fairness_report.json").write_text(json.dumps(fair, indent=2))
    for g in fair["gaps"]:
        print(f"  {g['stratum']:16s} tpr gap {g['tpr_gap']:.4f}  fpr gap {g['fpr_gap']:.4f}")
    print(f"  max equalised-odds gap {fair['max_equalised_odds_gap']:.4f} "
          f"(tolerance {FAIRNESS_TOLERANCE}) -> "
          f"{'WITHIN' if fair['within_tolerance'] else 'BREACHES'}")
    print(f"Wrote {(ARTIFACTS / 'fairness_report.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
