"""Draft radiology reports — grounded generation with a deterministic fallback.

The safety problem
------------------
A language model asked to "write a radiology report for this chest X-ray" will
produce a fluent, confident, plausible report containing findings that the
vision model never detected. In a clinical context that is the single most
dangerous failure mode in the system: the hallucination is indistinguishable
from a real finding because it is written in the same register.

The defence has three parts.

1. **The model never sees the image.** It receives only the structured output
   of the vision pipeline — probabilities, the conformal prediction set,
   uncertainty decomposition, Grad-CAM regions, progression. It cannot invent a
   finding from pixels because it has no pixels.

2. **The vocabulary is closed.** The prompt states the complete list of
   pathologies that may be mentioned. Anything else is out of bounds.

3. **The output is verified before it is shown.** `verify_grounding` scans the
   generated text for any of the 14 pathology names that were not in the
   supported set. If it finds one, the generation is discarded, the incident is
   logged to the audit trail, and the deterministic template is used instead.

Layer 3 is what makes layers 1 and 2 trustworthy: prompt instructions are a
request, verification is a guarantee. This is tested adversarially in
`tests/test_grounding.py`.

Without `GEMINI_API_KEY` the template path runs and the system is fully
functional. The LLM is an enhancement, never a dependency.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx

from ..config import get_settings
from ..core.pathologies import DESCRIPTIONS, PATHOLOGIES, display_name

log = logging.getLogger(__name__)
settings = get_settings()

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

DISCLAIMER = (
    "This is an automated draft produced by a student research prototype. "
    "It is not a medical device and must not be used for clinical decisions. "
    "A qualified radiologist must review the image."
)


@dataclass(frozen=True)
class ReportResult:
    text: str
    source: str          # "gemini" | "template"
    grounded: bool
    rejected_reason: str = ""


# ── grounding verification ──────────────────────────────────────────────
def verify_grounding(text: str, supported: set[str]) -> tuple[bool, str]:
    """Reject any generated text that names an unsupported pathology.

    Matching is on word boundaries over both the raw label (`Pleural_Thickening`)
    and its display form (`Pleural Thickening`), case-insensitively.
    """
    lowered = text.lower()
    supported_lower = {s.lower() for s in supported}

    for pathology in PATHOLOGIES:
        if pathology.lower() in supported_lower:
            continue
        for variant in {pathology.lower(), display_name(pathology).lower()}:
            if re.search(rf"\b{re.escape(variant)}\b", lowered):
                return False, (
                    f"Generated text mentions '{display_name(pathology)}', which "
                    f"the vision model did not support."
                )
    return True, ""


# ── deterministic template ──────────────────────────────────────────────
def render_template(context: dict) -> str:
    """Structured report built only from model output. Always available."""
    findings: list[dict] = context.get("findings", [])
    conformal: dict = context.get("conformal", {})
    progression: dict = context.get("progression", {})
    triage: dict = context.get("triage", {})

    positive = [f for f in findings if f.get("included")]
    positive.sort(key=lambda f: f["probability"], reverse=True)

    lines: list[str] = ["TECHNIQUE", "Frontal chest radiograph, single view.", ""]

    lines.append("FINDINGS")
    if context.get("is_ood"):
        score = context.get("ood_score")
        threshold = context.get("ood_threshold")
        detail = (
            f" ({score:.4f} against a threshold of {threshold:.4f})"
            if score is not None and threshold is not None
            else ""
        )
        lines += [
            "The submitted image was rejected before analysis. Its reconstruction "
            f"error under the variational autoencoder{detail} exceeded the "
            "distributional threshold, indicating it is not a frontal chest "
            "radiograph of the kind this system was trained on.",
            "",
            "Upload a frontal chest radiograph.",
            "",
        ]
    elif not positive:
        lines += [
            "No pathology met the calibrated detection threshold at the "
            f"{conformal.get('coverage_target', 0.9):.0%} coverage level.",
            "",
        ]
    else:
        for f in positive:
            lines.append(
                f"- {display_name(f['name'])}: probability {f['probability']:.2f} "
                f"(threshold {f['threshold']:.2f}). "
                f"{DESCRIPTIONS.get(f['name'], '')}"
            )
        lines.append("")

    near_miss = [
        f for f in findings
        if not f.get("included") and 0.0 > f.get("margin", -1.0) > -0.10
    ]
    if near_miss:
        lines.append("BORDERLINE")
        for f in near_miss:
            lines.append(
                f"- {display_name(f['name'])}: {f['probability']:.2f}, just below "
                f"its threshold of {f['threshold']:.2f}."
            )
        lines.append("")

    if progression.get("available"):
        lines += [
            "COMPARISON",
            progression.get("narrative", "Prior studies available."),
            "",
        ]

    lines.append("IMPRESSION")
    if conformal.get("abstained"):
        lines += [
            "The system has abstained from this study.",
            conformal.get("abstain_reason", ""),
            "Radiologist review is required.",
        ]
    elif context.get("is_ood"):
        lines.append("Not assessable. Submit a frontal chest radiograph.")
    elif positive:
        top = positive[0]
        lines.append(
            f"Findings most consistent with {display_name(top['name']).lower()}. "
            f"Prediction set: {', '.join(display_name(p) for p in conformal.get('prediction_set', [])) or 'empty'}."
        )
    else:
        lines.append("No acute cardiopulmonary abnormality detected by the model.")

    if triage.get("priority"):
        lines += ["", f"TRIAGE: {triage['priority']} — {triage.get('rationale', '')}"]

    lines += ["", "—", DISCLAIMER]
    return "\n".join(lines)


# ── Gemini ──────────────────────────────────────────────────────────────
def _build_prompt(context: dict, supported: list[str]) -> str:
    findings = context.get("findings", [])
    positive = [f for f in findings if f.get("included")]
    conformal = context.get("conformal", {})

    evidence = "\n".join(
        f"- {display_name(f['name'])}: probability {f['probability']:.3f}, "
        f"threshold {f['threshold']:.3f}, epistemic uncertainty {f.get('epistemic', 0):.3f}"
        for f in positive
    ) or "- None above threshold"

    allowed = ", ".join(display_name(s) for s in supported) or "none"

    return f"""You are drafting the FINDINGS and IMPRESSION sections of a chest radiograph report for radiologist review.

You are NOT looking at an image. You are given the structured output of a vision model. Write only what these numbers support.

DETECTED FINDINGS (above calibrated threshold):
{evidence}

CONFORMAL PREDICTION SET: {', '.join(display_name(p) for p in conformal.get('prediction_set', [])) or 'empty'}
COVERAGE LEVEL: {conformal.get('coverage_target', 0.9):.0%}
ABSTAINED: {conformal.get('abstained', False)}
{('ABSTENTION REASON: ' + conformal.get('abstain_reason', '')) if conformal.get('abstained') else ''}
PROGRESSION: {context.get('progression', {}).get('narrative', 'No prior studies available.')}

RULES — these are absolute:
1. You may mention ONLY these pathologies: {allowed}. Naming any other pathology is a critical error.
2. Do not invent findings, measurements, laterality, or clinical history.
3. If the system abstained, say so plainly and state that radiologist review is required. Do not offer a diagnosis.
4. Express uncertainty where the numbers are uncertain. Do not round confidence upward in your language.
5. Use the register of a radiology report: concise, declarative, no hedging filler.
6. Output sections FINDINGS and IMPRESSION only. No preamble, no markdown headers.

Write the report."""


async def _call_gemini(prompt: str) -> str:
    url = GEMINI_ENDPOINT.format(model=settings.gemini_model)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            url,
            headers={
                "x-goog-api-key": settings.gemini_api_key,
                "Content-Type": "application/json",
            },
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,      # low: this is a factual transform
                    "maxOutputTokens": 700,
                    "topP": 0.8,
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()

    candidates = data.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini returned no candidates (possibly safety-filtered).")
    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise ValueError("Gemini returned empty text.")
    return text


async def generate_report(context: dict) -> ReportResult:
    """Draft a report, preferring Gemini but never trusting it blindly."""
    template = render_template(context)

    if not settings.gemini_enabled:
        return ReportResult(text=template, source="template", grounded=True)

    supported = [f["name"] for f in context.get("findings", []) if f.get("included")]

    try:
        raw = await _call_gemini(_build_prompt(context, supported))
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        log.warning("Gemini unavailable (%s); using template", exc)
        return ReportResult(text=template, source="template", grounded=True)

    ok, reason = verify_grounding(raw, set(supported))
    if not ok:
        log.warning("Rejected ungrounded generation: %s", reason)
        return ReportResult(
            text=template, source="template", grounded=False, rejected_reason=reason
        )

    return ReportResult(text=f"{raw}\n\n—\n{DISCLAIMER}", source="gemini", grounded=True)
