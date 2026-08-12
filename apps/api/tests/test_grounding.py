"""Adversarial tests for LLM grounding.

The threat: a language model writes a fluent report naming a pathology the
vision model never detected. Because it reads exactly like a real finding, a
clinician has no way to tell it apart. This is the most dangerous failure mode
in the system.

Prompt instructions are a request. `verify_grounding` is the guarantee. These
tests attack it directly.
"""

from __future__ import annotations

import pytest

from app.core.pathologies import PATHOLOGIES
from app.services.reporting import DISCLAIMER, render_template, verify_grounding


def finding(name: str, prob: float, included: bool, threshold: float = 0.5) -> dict:
    return {
        "name": name,
        "probability": prob,
        "threshold": threshold,
        "included": included,
        "margin": round(prob - threshold, 4),
        "epistemic": 0.05,
    }


class TestGroundingVerification:
    def test_accepts_supported_finding(self):
        ok, _ = verify_grounding(
            "FINDINGS\nRight pleural effusion is present.", {"Effusion"}
        )
        assert ok

    def test_rejects_unsupported_finding(self):
        ok, reason = verify_grounding(
            "FINDINGS\nThere is a large pneumothorax on the left.", {"Effusion"}
        )
        assert not ok
        assert "Pneumothorax" in reason

    def test_rejects_display_name_variant(self):
        """`Pleural_Thickening` must be caught as 'Pleural Thickening' too."""
        ok, reason = verify_grounding("Marked pleural thickening noted.", set())
        assert not ok
        assert "Pleural Thickening" in reason

    def test_case_insensitive(self):
        ok, _ = verify_grounding("CARDIOMEGALY IS PRESENT", {"Effusion"})
        assert not ok

    def test_word_boundaries_prevent_false_positives(self):
        """'massive' contains 'mass' but is not the finding 'Mass'."""
        ok, _ = verify_grounding(
            "There is massive consolidation.", {"Consolidation"}
        )
        assert ok, "substring match must not trigger on 'massive'"

    def test_negation_still_rejected(self):
        """Even 'no pneumothorax' introduces a finding the model never assessed.

        A radiologist reading 'no pneumothorax' reasonably infers the system
        looked for one and ruled it out. If it was not in the supported set,
        that inference is false, so the text is rejected.
        """
        ok, _ = verify_grounding("No pneumothorax is seen.", {"Effusion"})
        assert not ok

    @pytest.mark.parametrize("pathology", PATHOLOGIES)
    def test_every_pathology_is_detectable(self, pathology):
        """No label may slip through the filter."""
        text = f"The study demonstrates {pathology.replace('_', ' ')}."
        ok, _ = verify_grounding(text, set())
        assert not ok, f"{pathology} was not caught by the grounding filter"

    def test_empty_supported_set_rejects_any_pathology(self):
        ok, _ = verify_grounding("Findings suggest nodule.", set())
        assert not ok

    def test_clean_text_with_no_pathologies_passes(self):
        ok, _ = verify_grounding(
            "FINDINGS\nNo acute abnormality.\n\nIMPRESSION\nUnremarkable study.",
            set(),
        )
        assert ok


class TestTemplateReport:
    def test_always_carries_disclaimer(self):
        text = render_template(
            {"findings": [], "conformal": {"coverage_target": 0.9}, "triage": {}}
        )
        assert DISCLAIMER in text

    def test_template_is_self_grounded(self):
        """The fallback must itself pass the grounding check it protects."""
        ctx = {
            "findings": [
                finding("Effusion", 0.88, True),
                finding("Nodule", 0.20, False),
            ],
            "conformal": {
                "prediction_set": ["Effusion"],
                "coverage_target": 0.9,
                "abstained": False,
            },
            "progression": {"available": False},
            "triage": {"priority": "URGENT", "rationale": "possible finding"},
        }
        text = render_template(ctx)
        ok, reason = verify_grounding(text, {"Effusion"})
        assert ok, f"template violated its own grounding rule: {reason}"

    def test_abstention_is_stated_plainly(self):
        text = render_template(
            {
                "findings": [],
                "conformal": {
                    "abstained": True,
                    "abstain_reason": "Model uncertainty exceeds bound.",
                    "coverage_target": 0.9,
                    "prediction_set": [],
                },
                "triage": {},
            }
        )
        assert "abstained" in text.lower()
        assert "Radiologist review is required" in text

    def test_ood_rejection_does_not_diagnose(self):
        text = render_template(
            {
                "findings": [],
                "conformal": {"coverage_target": 0.9, "prediction_set": []},
                "triage": {},
                "is_ood": True,
            }
        )
        assert "Not assessable" in text
        assert "rejected before analysis" in text

    def test_borderline_findings_surfaced(self):
        ctx = {
            "findings": [finding("Nodule", 0.46, False, threshold=0.50)],
            "conformal": {"coverage_target": 0.9, "prediction_set": []},
            "triage": {},
        }
        text = render_template(ctx)
        assert "BORDERLINE" in text
        assert "Nodule" in text
