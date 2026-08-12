"""Tests for the pure core: conformal coverage, uncertainty, triage, progression.

These are the claims the project actually makes, so these are the tests that
matter most. If `test_coverage_guarantee_holds` fails, the central thesis of
the system is false and no amount of UI polish compensates.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.conformal import (
    ConformalCalibrator,
    conformal_quantile,
    empirical_coverage,
)
from app.core.pathologies import INDEX, N_PATHOLOGIES, PATHOLOGIES
from app.core.progression import compare
from app.core.triage import (
    HeuristicPolicy,
    TriagePriority,
    build_state,
    load_policy,
    triage,
)
from app.core.uncertainty import confidence_to_chroma, decompose

RNG = np.random.default_rng(20260812)


def synthetic(n: int = 3000, signal: float = 0.42):
    """Labels plus deliberately miscalibrated scores that still rank correctly."""
    labels = RNG.random((n, N_PATHOLOGIES)) < 0.12
    probs = np.clip(RNG.beta(2, 5, (n, N_PATHOLOGIES)) + labels * signal, 0, 1)
    return probs, labels


# ── conformal ───────────────────────────────────────────────────────────
class TestConformal:
    def test_finite_sample_correction_applied(self):
        # With 5 points and alpha=0.10 the corrected rank is ceil(6*0.9)=6 > 5,
        # so the guarantee is unattainable and we must admit everything rather
        # than silently over-claim coverage.
        assert conformal_quantile(np.array([0.1, 0.2, 0.3, 0.4, 0.9]), 0.10) == 1.0

    def test_quantile_uses_corrected_rank(self):
        scores = np.linspace(0, 1, 100)
        q = conformal_quantile(scores, 0.10)
        assert 0.88 <= q <= 0.93

    def test_empty_calibration_is_permissive_not_silent(self):
        assert conformal_quantile(np.array([]), 0.10) == 1.0

    @pytest.mark.parametrize("alpha", [0.05, 0.10, 0.20])
    def test_coverage_guarantee_holds(self, alpha):
        """The system's central claim: realised coverage >= nominal.

        Split conformal gives marginal coverage of at least 1-alpha under
        exchangeability. We allow a small downward tolerance for finite-sample
        noise on rarer labels.
        """
        probs, labels = synthetic(4000)
        cal_probs, cal_labels = probs[:2000], labels[:2000]
        test_probs, test_labels = probs[2000:], labels[2000:]

        c = ConformalCalibrator(alpha=alpha).fit(cal_probs, cal_labels)
        cov = empirical_coverage(test_probs, test_labels, c)

        assert cov["_macro_average"] >= (1 - alpha) - 0.03, (
            f"macro coverage {cov['_macro_average']:.4f} below target {1 - alpha}"
        )

    def test_abstains_when_set_too_large(self):
        c = ConformalCalibrator(alpha=0.10, max_set_size=3)
        c.thresholds = np.full(N_PATHOLOGIES, 0.95)  # admit almost anything
        c.fitted = True
        result = c.predict(np.full(N_PATHOLOGIES, 0.6))
        assert result.abstained
        assert "diffusely uncertain" in result.abstain_reason

    def test_abstains_on_high_epistemic_uncertainty(self):
        c = ConformalCalibrator(alpha=0.10).fit(*synthetic(1000))
        result = c.predict(
            np.full(N_PATHOLOGIES, 0.5),
            epistemic=np.full(N_PATHOLOGIES, 0.9),
            epistemic_bound=0.45,
        )
        assert result.abstained
        assert "uncertainty" in result.abstain_reason.lower()

    def test_critical_near_miss_escalates(self):
        """A pneumothorax just under threshold must never be silently dropped."""
        c = ConformalCalibrator(alpha=0.10)
        c.thresholds = np.full(N_PATHOLOGIES, 0.30)  # prob threshold = 0.70
        c.fitted = True
        probs = np.zeros(N_PATHOLOGIES)
        probs[INDEX["Pneumothorax"]] = 0.65  # below 0.70, within the 0.08 margin
        result = c.predict(probs)
        assert "Pneumothorax" not in result.prediction_set
        assert result.escalate, "near-miss critical finding must escalate"

    def test_roundtrip_persistence(self, tmp_path):
        c = ConformalCalibrator(alpha=0.10).fit(*synthetic(1000))
        path = tmp_path / "cal.json"
        c.save(path)
        loaded = ConformalCalibrator.load(path)
        assert np.allclose(c.thresholds, loaded.thresholds)
        assert loaded.fitted

    def test_rejects_wrong_shape(self):
        c = ConformalCalibrator()
        with pytest.raises(ValueError, match="expected 14"):
            c.predict(np.zeros(5))


# ── uncertainty ─────────────────────────────────────────────────────────
class TestUncertainty:
    def test_disagreement_raises_epistemic_not_aleatoric(self):
        """BALD's defining property: confident-but-disagreeing => epistemic."""
        agreeing = np.clip(
            np.tile(0.9, (20, N_PATHOLOGIES)) + RNG.normal(0, 0.01, (20, N_PATHOLOGIES)),
            0,
            1,
        )
        disagreeing = np.tile(0.5, (20, N_PATHOLOGIES))
        disagreeing[::2] = 0.97
        disagreeing[1::2] = 0.03

        assert decompose(disagreeing).max_epistemic > decompose(agreeing).max_epistemic

    def test_ambiguous_data_is_aleatoric(self):
        """All samples agreeing on p=0.5 is irreducible noise, not ignorance."""
        u = decompose(np.tile(0.5, (20, N_PATHOLOGIES)))
        assert u.epistemic.max() < 0.01
        assert u.aleatoric.max() > 0.6
        assert u.dominant_source(0) == "aleatoric"

    def test_total_equals_aleatoric_plus_epistemic(self):
        u = decompose(np.clip(RNG.random((30, N_PATHOLOGIES)), 0.01, 0.99))
        assert np.allclose(u.total, u.aleatoric + u.epistemic, atol=1e-9)

    def test_requires_multiple_samples(self):
        with pytest.raises(ValueError, match="at least 2"):
            decompose(np.zeros((1, N_PATHOLOGIES)))

    @pytest.mark.parametrize(
        "prob,thresh,expected", [(0.3, 0.3, 0.0), (0.1, 0.3, 0.0), (1.0, 0.3, 1.0)]
    )
    def test_chroma_bounds(self, prob, thresh, expected):
        assert confidence_to_chroma(prob, thresh) == expected

    def test_chroma_is_monotonic(self):
        vals = [confidence_to_chroma(p, 0.3) for p in np.linspace(0.3, 1.0, 20)]
        assert all(b >= a for a, b in zip(vals, vals[1:]))


# ── triage ──────────────────────────────────────────────────────────────
class TestTriage:
    def test_fresh_critical_finding_is_stat(self):
        probs = np.zeros(N_PATHOLOGIES)
        probs[INDEX["Pneumothorax"]] = 0.91
        d = triage(build_state(probs, queue_depth=10), HeuristicPolicy())
        assert d.priority == TriagePriority.STAT, (
            "a confident pneumothorax must be STAT on arrival, not after ageing"
        )

    def test_urgency_ordering(self):
        pol = HeuristicPolicy()

        def score(name, p):
            probs = np.zeros(N_PATHOLOGIES)
            probs[INDEX[name]] = p
            return triage(build_state(probs), pol).score

        assert score("Pneumothorax", 0.9) > score("Edema", 0.9) > score("Hernia", 0.9)

    def test_low_urgency_never_outranks_critical(self):
        pol = HeuristicPolicy()
        hernia = np.zeros(N_PATHOLOGIES)
        hernia[INDEX["Hernia"]] = 0.95
        pneumo = np.zeros(N_PATHOLOGIES)
        pneumo[INDEX["Pneumothorax"]] = 0.55
        assert (
            triage(build_state(pneumo), pol).score
            > triage(build_state(hernia, wait_minutes=300), pol).score
        )

    def test_waiting_cannot_starve_critical_cases(self):
        """Wait time saturates, so an old routine study never beats a new STAT."""
        pol = HeuristicPolicy()
        routine = np.zeros(N_PATHOLOGIES)
        routine[INDEX["Fibrosis"]] = 0.9
        critical = np.zeros(N_PATHOLOGIES)
        critical[INDEX["Pneumothorax"]] = 0.85
        assert (
            triage(build_state(critical), pol).score
            > triage(build_state(routine, wait_minutes=100_000), pol).score
        )

    def test_corrupt_policy_falls_back_not_crashes(self, tmp_path):
        bad = tmp_path / "policy.json"
        bad.write_text("{ not json")
        assert isinstance(load_policy(bad), HeuristicPolicy)

    def test_missing_policy_uses_heuristic(self):
        assert load_policy(None).name == "heuristic-v1"

    def test_abstention_is_surfaced_in_rationale(self):
        d = triage(
            build_state(np.zeros(N_PATHOLOGIES), abstained=True), HeuristicPolicy()
        )
        assert "abstain" in d.rationale.lower()


# ── progression ─────────────────────────────────────────────────────────
class TestProgression:
    def test_no_priors_is_unavailable(self):
        assert not compare(np.zeros(N_PATHOLOGIES), []).available

    def test_detects_worsening_on_urgent_finding(self):
        prior = np.zeros(N_PATHOLOGIES)
        current = np.zeros(N_PATHOLOGIES)
        current[INDEX["Edema"]] = 0.7
        r = compare(current, [prior])
        assert r.trend == "worsening"
        assert r.worsening
        assert "Edema" in r.delta

    def test_detects_improvement(self):
        prior = np.zeros(N_PATHOLOGIES)
        prior[INDEX["Effusion"]] = 0.8
        current = np.zeros(N_PATHOLOGIES)
        r = compare(current, [prior])
        assert r.trend == "improving"

    def test_small_changes_are_noise(self):
        prior = np.full(N_PATHOLOGIES, 0.5)
        current = prior + 0.02
        r = compare(current, [prior])
        assert r.trend == "stable"
        assert r.delta == {}
        assert "No material change" in r.narrative

    def test_compares_against_most_recent_prior(self):
        old = np.zeros(N_PATHOLOGIES)
        recent = np.zeros(N_PATHOLOGIES)
        recent[INDEX["Effusion"]] = 0.9
        current = np.zeros(N_PATHOLOGIES)
        current[INDEX["Effusion"]] = 0.9
        r = compare(current, [old, recent])
        assert r.trend == "stable"
        assert r.n_priors == 2


def test_pathology_ordering_is_stable():
    """Every score vector in the system depends on this order never changing."""
    assert len(PATHOLOGIES) == 14
    assert PATHOLOGIES[0] == "Atelectasis"
    assert PATHOLOGIES[-1] == "Pneumothorax"
    assert all(INDEX[p] == i for i, p in enumerate(PATHOLOGIES))
