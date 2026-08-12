/** Contracts mirroring apps/api/app/schemas.py. */

export interface PathologyFinding {
  name: string;
  display_name: string;
  description: string;
  probability: number;
  threshold: number;
  included: boolean;
  margin: number;
  /** UI saturation in [0,1]. Computed by the API so the two cannot disagree. */
  chroma: number;
  epistemic: number;
  aleatoric: number;
  dominant_uncertainty: "confident" | "aleatoric" | "epistemic" | "unknown";
  urgency: number;
}

export interface ConformalOut {
  prediction_set: string[];
  abstained: boolean;
  abstain_reason: string | null;
  alpha: number;
  coverage_target: number;
  escalate: boolean;
  per_label?: Record<string, Record<string, number | boolean>>;
}

export interface ProgressionOut {
  available: boolean;
  n_priors: number;
  trend: "improving" | "stable" | "worsening" | "unknown";
  delta: Record<string, number>;
  narrative: string;
}

export interface Study {
  id: string;
  patient_ref: string;
  follow_up_index: number;
  status: "pending" | "complete" | "rejected" | "failed";
  mode: "full" | "reduced";
  image_url: string;
  original_filename: string;
  is_ood: boolean;
  ood_score: number;
  abstained: boolean;
  abstain_reason: string;
  findings: PathologyFinding[];
  conformal: ConformalOut | null;
  progression: ProgressionOut | null;
  gradcam: Record<string, string>;
  /** Raw aleatoric/epistemic decomposition, when the full path produced one. */
  uncertainty: {
    n_samples?: number;
    max_epistemic?: number;
    note?: string;
    per_label?: Record<
      string,
      {
        mean: number;
        std: number;
        total: number;
        aleatoric: number;
        epistemic: number;
        dominant: string;
      }
    >;
  };
  triage_score: number;
  triage_priority: "STAT" | "URGENT" | "ROUTINE";
  triage_rationale: string;
  report_text: string;
  report_source: string;
  reviewed_by: string;
  review_note: string;
  latency_ms: number;
  error: string;
  created_at: string;
}

export interface WorklistItem {
  id: string;
  patient_ref: string;
  triage_priority: "STAT" | "URGENT" | "ROUTINE";
  triage_score: number;
  triage_rationale: string;
  abstained: boolean;
  is_ood: boolean;
  top_finding: string;
  top_probability: number;
  waited_minutes: number;
  status: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

export interface ReadyState {
  ready: boolean;
  backends: { inference_core: string; fast_path: string };
  gemini: string;
  calibration: boolean;
  triage_policy: string;
  mode: "full" | "reduced";
  storage?: "ephemeral" | "persistent";
  storage_note?: string;
}

export interface CalibrationState {
  fitted: boolean;
  alpha: number;
  coverage_target: number;
  max_set_size: number;
  thresholds: Record<
    string,
    {
      probability_threshold: number;
      n_calibration_positives: number;
      empirical_coverage: number | null;
    }
  >;
  macro_coverage?: number | null;
  provenance?: {
    n_calibration_images?: number;
    n_test_images?: number;
    n_patients?: number;
    split?: string;
    model?: string;
  };
  warning: string | null;
  backends: Record<string, string>;
}
