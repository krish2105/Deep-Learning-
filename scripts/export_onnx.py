#!/usr/bin/env python3
"""Export the classifier to a quantised ONNX model for the orchestrator.

Why this exists
---------------
Render's free tier has 512 MB and cannot hold PyTorch, so the original design
put all inference on Hugging Face Spaces. That made the deployed system depend
on a second free service being awake — and when the Space is missing or asleep,
nothing gets diagnosed at all.

An int8 ONNX DenseNet-121 is roughly 7 MB and runs under a second on 0.1 CPU.
Committing it makes the orchestrator self-sufficient: real predictions with no
Space, no token, and no cold start. The Space still upgrades the result when it
is available, adding Grad-CAM and MC sampling that the fast path cannot do.

The export is verified against the PyTorch model before it is written. An ONNX
file that silently disagrees with its source would be worse than no file, since
every downstream conformal threshold is calibrated against the original.

Run:  python scripts/export_onnx.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "apps" / "api" / "artifacts"
FP32 = OUT_DIR / "densenet121_fp32.onnx"
INT8 = OUT_DIR / "densenet121_int8.onnx"

# Must match apps/api/app/core/pathologies.py exactly.
PATHOLOGIES = (
    "Atelectasis", "Cardiomegaly", "Consolidation", "Edema", "Effusion",
    "Emphysema", "Fibrosis", "Hernia", "Infiltration", "Mass", "Nodule",
    "Pleural_Thickening", "Pneumonia", "Pneumothorax",
)

# Tolerance for int8 vs fp32 agreement. Quantisation is lossy by design; what
# matters is that the RANKING and the calibrated decisions survive it.
MAX_MEAN_ABS_DIFF = 0.05


class Reordered(torch.nn.Module):
    """Emits our 14 labels in canonical order, plus a class activation map each.

    Two jobs, both about making the orchestrator self-sufficient.

    **Label order.** TorchXRayVision publishes 18 heads in a different order.
    Baking the reorder into the graph means a future weight swap cannot
    silently misalign labels.

    **Explainability without gradients.** Grad-CAM needs a backward pass, which
    ONNX Runtime does not do, so the fast path had no heat maps at all and the
    Explainability tab sat empty unless a Hugging Face Space was running. But
    DenseNet ends in global average pooling followed by a linear layer, which
    is exactly the architecture classic CAM (Zhou et al., 2016) was defined
    for: the class map is the classifier's weights applied across the final
    feature maps. That needs only the forward pass we are already doing, so the
    14 maps are computed inside the graph and returned alongside the scores —
    686 extra floats.

    This is CAM, not Grad-CAM. It is reported as such in the interface: the two
    agree for this architecture but they are not the same method.
    """

    def __init__(self, model, source_order: list[str]) -> None:
        super().__init__()
        self.model = model
        idx, mask = [], []
        for name in PATHOLOGIES:
            if name in source_order:
                idx.append(source_order.index(name))
                mask.append(1.0)
            else:
                idx.append(0)
                mask.append(0.0)
        self.register_buffer("idx", torch.tensor(idx, dtype=torch.long))
        self.register_buffer("mask", torch.tensor(mask, dtype=torch.float32))
        # Classifier weights reordered to our label order: (14, 1024)
        w = model.classifier.weight.detach()
        self.register_buffer("cam_w", w.index_select(0, torch.tensor(idx)))
        ot = getattr(model, "op_threshs", None)
        if ot is not None:
            self.register_buffer("op_threshs", ot.detach().clone())
        else:
            self.op_threshs = None

    def forward(self, x: torch.Tensor):
        # The backbone runs ONCE. Calling model(x) and model.features(x)
        # separately duplicates the whole convolutional subgraph, which the
        # dynamic quantiser then refuses to process ("expected ... to be an
        # initializer"). Deriving both outputs from a single feature tensor is
        # also simply correct: they are two views of the same activation.
        feats = torch.nn.functional.relu(self.model.features(x))

        pooled = torch.nn.functional.adaptive_avg_pool2d(feats, (1, 1)).flatten(1)
        logits = self.model.classifier(pooled)
        probs = torch.sigmoid(logits)
        if self.op_threshs is not None:
            # TorchXRayVision normalises each head against its operating point,
            # so 0.5 means "at threshold" rather than "no idea". Replicating it
            # keeps the exported model numerically identical to the source.
            #
            # Written with torch.where rather than the upstream boolean-mask
            # assignment: masked in-place writes do not trace to ONNX (they
            # emit a Reshape against a data-dependent shape, which fails at
            # runtime). NaN thresholds mark heads this checkpoint does not
            # predict, and those stay at 0.5.
            t = self.op_threshs
            valid = ~torch.isnan(t)
            t_safe = torch.where(valid, t, torch.full_like(t, 0.5))
            below = probs / (t_safe * 2.0)
            above = 1.0 - ((1.0 - probs) / ((1.0 - t_safe) * 2.0))
            normed = torch.where(probs < t_safe, below, above)
            probs = torch.where(valid, normed, torch.full_like(normed, 0.5))
        scores = probs.index_select(1, self.idx) * self.mask

        # CAM_c(h,w) = sum_k W[c,k] * A_k(h,w)   -> (B, 14, 7, 7)
        cams = torch.einsum("ck,bkhw->bchw", self.cam_w, feats)
        return scores, cams


def _pinned_onnxruntime() -> str | None:
    """The onnxruntime version the deployed API will run, from requirements."""
    req = ROOT / "apps" / "api" / "requirements.txt"
    if not req.exists():
        return None
    for line in req.read_text().splitlines():
        if line.strip().startswith("onnxruntime=="):
            return line.split("==", 1)[1].strip()
    return None


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        import torchxrayvision as xrv
    except ImportError:
        sys.exit("pip install torchxrayvision")

    print("Loading densenet121-res224-nih …")
    base = xrv.models.DenseNet(weights="densenet121-res224-nih").eval()
    source_order = list(base.pathologies)
    model = Reordered(base, source_order).eval()

    # TorchXRayVision expects greyscale scaled to [-1024, 1024]; the dummy input
    # must sit in that range or the exported graph is traced on the wrong scale.
    dummy = (torch.rand(1, 1, 224, 224) * 2048.0) - 1024.0

    print("Exporting FP32 ONNX …")
    # dynamo=False selects the legacy TorchScript exporter. TorchXRayVision's
    # forward() calls a normalisation check with data-dependent branching, which
    # torch.export cannot trace; the tracer simply follows the branch taken by
    # the dummy input, which is the correct one for our fixed input scale.
    torch.onnx.export(
        model,
        dummy,
        str(FP32),
        input_names=["image"],
        output_names=["scores", "cams"],
        dynamic_axes={
            "image": {0: "batch"},
            "scores": {0: "batch"},
            "cams": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    print(f"  {FP32.name}  {FP32.stat().st_size / 1e6:.1f} MB")

    print("Quantising to int8 …")
    from onnxruntime.quantization import QuantType, quantize_dynamic

    # QUInt8, not QInt8. Both emit ConvInteger nodes, but onnxruntime's CPU
    # provider only ships a kernel for the unsigned variant until 1.22 — a
    # QInt8 model exports and quantises without complaint, then fails at
    # SESSION CREATION on the deployed runtime with NOT_IMPLEMENTED. Since the
    # pinned server version is older than this machine's, that failure appears
    # only in production, which is exactly where it appeared.
    quantize_dynamic(
        model_input=str(FP32),
        model_output=str(INT8),
        weight_type=QuantType.QUInt8,
    )
    print(f"  {INT8.name}  {INT8.stat().st_size / 1e6:.1f} MB")

    # ── verification ────────────────────────────────────────────────────
    import onnxruntime as ort

    # Check the runtime that will actually SERVE this file matches the one
    # verifying it. Exporting on a newer onnxruntime than production silently
    # allows operators the server cannot execute.
    pinned = _pinned_onnxruntime()
    if pinned and pinned != ort.__version__:
        print(
            f"\n  WARNING: exporting with onnxruntime {ort.__version__} but "
            f"apps/api/requirements.txt pins {pinned}.\n"
            f"  Operator support differs between versions. Install the pinned "
            f"version before trusting this export:\n"
            f"      pip install onnxruntime=={pinned}"
        )

    print("\nCreating an inference session (catches unsupported operators) …")
    try:
        sess = ort.InferenceSession(str(INT8), providers=["CPUExecutionProvider"])
    except Exception as exc:
        INT8.unlink(missing_ok=True)
        FP32.unlink(missing_ok=True)
        sys.exit(
            f"FAILED: the quantised model does not load on onnxruntime "
            f"{ort.__version__}:\n  {exc}\n"
            "Refusing to ship a model the server cannot execute."
        )
    print("  session created OK")

    print("\nVerifying against PyTorch on random inputs …")
    name = sess.get_inputs()[0].name

    diffs, rank_ok = [], 0
    trials = 8
    for t in range(trials):
        x = (torch.rand(1, 1, 224, 224) * 2048.0) - 1024.0
        with torch.no_grad():
            ref = torch.sigmoid(model(x)[0])[0].numpy()
        outs = sess.run(None, {name: x.numpy()})
        got = 1.0 / (1.0 + np.exp(-np.asarray(outs[0]).ravel()))
        diffs.append(float(np.abs(ref - got).mean()))
        if np.argmax(ref) == np.argmax(got):
            rank_ok += 1

    mean_diff = float(np.mean(diffs))
    print(f"  mean |fp32 - int8| : {mean_diff:.5f}  (tolerance {MAX_MEAN_ABS_DIFF})")
    print(f"  top-1 agreement    : {rank_ok}/{trials}")

    if mean_diff > MAX_MEAN_ABS_DIFF:
        FP32.unlink(missing_ok=True)
        INT8.unlink(missing_ok=True)
        sys.exit(
            f"FAILED: quantised model diverges from source by {mean_diff:.5f}. "
            "Refusing to ship a model whose scores disagree with the weights the "
            "conformal thresholds were calibrated against."
        )

    # The fp32 file is only an intermediate; it is ~28 MB and not worth committing.
    FP32.unlink(missing_ok=True)
    cam_shape = sess.get_outputs()[1].shape
    print(f"  cam output         : {cam_shape}  (one activation map per label)")

    print(f"\nWrote {INT8.relative_to(ROOT)}")
    print("The orchestrator now serves real predictions with no Hugging Face Space.")


if __name__ == "__main__":
    main()
