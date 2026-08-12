"use client";

import { useEffect, useState } from "react";
import { AbstainBanner, ConfidenceChip } from "@/components/ConfidenceChip";
import {
  CoveragePlot,
  FairnessBars,
  ProbabilityBars,
  ProgressionChart,
  UncertaintyStack,
} from "@/components/charts/ClinicalCharts";
import {
  DisagreementPanel,
  SimilarPanel,
  TimelinePanel,
} from "@/components/console/AIPanels";
import { PrintableReport } from "@/components/console/PrintableReport";
import { api } from "@/lib/api";
import type { CalibrationState, Study } from "@/lib/types";
import { chromaColor, uncertaintyLabel } from "@/lib/utils";

export const TABS = [
  "Overview",
  "Findings",
  "Explainability",
  "Progression",
  "Uncertainty",
  "Similar",
  "Timeline",
  "Disagreement",
  "Fairness",
  "Report",
] as const;
export type Tab = (typeof TABS)[number];

export function Panel({
  tab,
  study,
  siblings = [],
  onOpen = () => {},
}: {
  tab: Tab;
  study: Study;
  /** Other studies for the same patient, so progression can be plotted. */
  siblings?: Study[];
  /** Jump to another study — similar cases and timeline entries are links. */
  onOpen?: (id: string) => void;
}) {
  switch (tab) {
    case "Overview":
      return <Overview study={study} />;
    case "Findings":
      return <Findings study={study} />;
    case "Explainability":
      return <Explainability study={study} />;
    case "Progression":
      return <Progression study={study} siblings={siblings} />;
    case "Uncertainty":
      return <Uncertainty study={study} />;
    case "Similar":
      return <SimilarPanel study={study} onOpen={onOpen} />;
    case "Timeline":
      return <TimelinePanel study={study} onOpen={onOpen} />;
    case "Disagreement":
      return <DisagreementPanel study={study} />;
    case "Fairness":
      return <Fairness />;
    case "Report":
      return <Report study={study} />;
  }
}

function Row({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-[var(--film-mid)]">{k}</span>
      <span className={`text-xs ${mono ? "tabular" : ""}`}>{v}</span>
    </div>
  );
}

function Overview({ study }: { study: Study }) {
  const positive = study.findings.filter((f) => f.included);
  return (
    <div className="space-y-5">
      {study.is_ood && (
        <div
          className="rounded-sm border p-4"
          style={{ borderColor: "var(--stat)", background: "var(--film-panel)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--stat)" }}>
            Rejected before analysis
          </p>
          <p className="mt-1.5 text-sm text-[var(--film-mid)]">
            Reconstruction error {study.ood_score.toFixed(4)} exceeded the
            distributional threshold. This is not a chest radiograph the model
            was trained on, so no classification was attempted.
          </p>
        </div>
      )}

      {study.abstained && <AbstainBanner reason={study.abstain_reason} />}

      {!study.is_ood && !study.abstained && (
        <div
          className="rounded-sm border p-4"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <p className="text-xs text-[var(--film-mid)]">Prediction set</p>
          {positive.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {positive.map((f) => (
                <span
                  key={f.name}
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{
                    background: `color-mix(in oklab, ${chromaColor(f.chroma)} 18%, transparent)`,
                    color: chromaColor(f.chroma),
                  }}
                >
                  {f.display_name} {f.probability.toFixed(2)}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm">
              Empty — no finding met its calibrated threshold.
            </p>
          )}
          {study.conformal && (
            <p className="mt-3 text-xs text-[var(--film-mid)]">
              Nominal coverage {(study.conformal.coverage_target * 100).toFixed(0)}
              % (α = {study.conformal.alpha}).
            </p>
          )}
        </div>
      )}

      <div
        className="rounded-sm border px-4 py-2"
        style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
      >
        <Row k="Triage" v={`${study.triage_priority} · ${study.triage_score.toFixed(3)}`} />
        <Row k="Inference mode" v={study.mode} />
        <Row k="Latency" v={`${study.latency_ms} ms`} />
        <Row k="Report source" v={study.report_source || "—"} />
        <Row k="Study" v={study.id.slice(0, 8)} />
      </div>

      <p className="text-xs text-[var(--film-mid)]">{study.triage_rationale}</p>
    </div>
  );
}

function Findings({ study }: { study: Study }) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = study.findings.find((f) => f.name === selected);

  return (
    <div className="space-y-4">
      <ProbabilityBars findings={study.findings} />

      <div className="space-y-1.5">
        {study.findings.map((f) => (
          <ConfidenceChip
            key={f.name}
            finding={f}
            selected={selected === f.name}
            onClick={() => setSelected(selected === f.name ? null : f.name)}
          />
        ))}
      </div>

      {current && (
        <div
          className="rounded-sm border p-4"
          style={{ borderColor: "var(--instrument)", background: "var(--film-panel)" }}
        >
          <p className="text-sm font-medium">{current.display_name}</p>
          <p className="mt-1.5 text-xs text-[var(--film-mid)]">{current.description}</p>
          <div className="mt-3">
            <Row k="Probability" v={current.probability.toFixed(4)} />
            <Row k="Conformal threshold" v={current.threshold.toFixed(4)} />
            <Row
              k="Margin"
              v={`${current.margin >= 0 ? "+" : ""}${current.margin.toFixed(4)}`}
            />
            <Row k="Clinical urgency" v={current.urgency.toFixed(2)} />
            <Row k="In prediction set" v={current.included ? "yes" : "no"} />
          </div>
        </div>
      )}
    </div>
  );
}

function Explainability({ study }: { study: Study }) {
  const keys = Object.keys(study.gradcam ?? {});
  return (
    <div className="space-y-4">
      {keys.length === 0 ? (
        <Empty
          title="No activation maps"
          body={
            "No finding scored high enough to warrant a map, or the activation " +
            "was too flat to localise. A flat map normalised into a heat map " +
            "would show confident-looking evidence that is not there."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {keys.map((k) => (
            <figure
              key={k}
              className="overflow-hidden rounded-sm border"
              style={{ borderColor: "var(--film-shoulder)" }}
            >
              <div className="viewer-surface relative aspect-square">
                {study.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={study.image_url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={study.gradcam[k]}
                  alt={`Activation map for ${k.replace(/_/g, " ")}`}
                  className="absolute inset-0 h-full w-full object-contain mix-blend-screen"
                />
              </div>
              <figcaption className="tabular px-3 py-2 text-[11px] text-[var(--film-mid)]">
                {k.replace(/_/g, " ")}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <p className="rounded-sm border px-3 py-2 text-xs text-[var(--film-mid)]"
         style={{ borderColor: "var(--film-shoulder)" }}>
        {study.mode === "reduced"
          ? "Class activation mapping — the classifier's weights applied across the final feature maps. It needs no backward pass, which is what makes explanation possible on the fast path."
          : "Grad-CAM, computed from gradients on the full inference path."}{" "}
        Either way it shows where activation correlates with the score. It is
        not a causal explanation, and a plausible-looking map is not evidence of
        correct reasoning.
      </p>
    </div>
  );
}

function Progression({ study, siblings }: { study: Study; siblings: Study[] }) {
  const p = study.progression;
  if (!p?.available) {
    return (
      <div className="space-y-4">
        <Empty
          title="No prior studies"
          body="Upload another study with the same patient reference to compare across time. The recurrent branch reads the sequence of visits."
        />
        <ProgressionChart studies={siblings} />
      </div>
    );
  }

  const color =
    p.trend === "worsening"
      ? "var(--stat)"
      : p.trend === "improving"
        ? "var(--instrument)"
        : "var(--film-mid)";

  return (
    <div className="space-y-4">
      <ProgressionChart studies={siblings} />

      <div
        className="rounded-sm border p-4"
        style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: color }}
          />
          <span className="tabular text-xs font-semibold tracking-[0.16em]"
                style={{ color }}>
            {p.trend.toUpperCase()}
          </span>
          <span className="ml-auto text-xs text-[var(--film-mid)]">
            {p.n_priors} prior{p.n_priors === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-3 text-sm">{p.narrative}</p>
      </div>

      {Object.keys(p.delta).length > 0 && (
        <div
          className="rounded-sm border px-4 py-2"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <p className="py-2 text-xs text-[var(--film-mid)]">
            Material change since the most recent prior
          </p>
          {Object.entries(p.delta).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 text-xs">{k.replace(/_/g, " ")}</span>
              <div className="h-1 w-24 overflow-hidden rounded-full"
                   style={{ background: "var(--film-shoulder)" }}>
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, Math.abs(v) * 100)}%`,
                    background: v > 0 ? "var(--stat)" : "var(--instrument)",
                    marginLeft: v > 0 ? "50%" : `${50 - Math.min(50, Math.abs(v) * 100)}%`,
                  }}
                />
              </div>
              <span className="tabular w-14 text-right text-xs"
                    style={{ color: v > 0 ? "var(--stat)" : "var(--instrument)" }}>
                {v > 0 ? "+" : ""}
                {v.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Uncertainty({ study }: { study: Study }) {
  const [cal, setCal] = useState<CalibrationState | null>(null);

  useEffect(() => {
    api.calibration().then(setCal).catch(() => setCal(null));
  }, []);

  const withUncertainty = study.findings.filter(
    (f) => f.epistemic > 0 || f.aleatoric > 0,
  );

  return (
    <div className="space-y-4">
      {cal?.warning && (
        <p
          className="rounded-sm border px-3 py-2 text-xs"
          style={{ borderColor: "var(--urgent)", color: "var(--urgent)" }}
        >
          {cal.warning}
        </p>
      )}

      <UncertaintyStack findings={study.findings} />

      {withUncertainty.length === 0 ? null : (
        <div
          className="rounded-sm border px-4 py-2"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <div className="flex justify-between border-b py-2 text-[11px] text-[var(--film-mid)]"
               style={{ borderColor: "var(--film-shoulder)" }}>
            <span>Finding</span>
            <span className="flex gap-4">
              <span className="w-16 text-right">Epistemic</span>
              <span className="w-16 text-right">Aleatoric</span>
            </span>
          </div>
          {withUncertainty.slice(0, 8).map((f) => (
            <div key={f.name} className="flex items-center justify-between py-1.5">
              <span className="flex-1 truncate text-xs">{f.display_name}</span>
              <span className="tabular flex gap-4 text-xs">
                <span
                  className="w-16 text-right"
                  style={{
                    color:
                      f.dominant_uncertainty === "epistemic"
                        ? "var(--urgent)"
                        : "var(--film-mid)",
                  }}
                >
                  {f.epistemic.toFixed(3)}
                </span>
                <span className="w-16 text-right text-[var(--film-mid)]">
                  {f.aleatoric.toFixed(3)}
                </span>
              </span>
            </div>
          ))}
          <p className="border-t py-3 text-[11px] text-[var(--film-mid)]"
             style={{ borderColor: "var(--film-shoulder)" }}>
            Epistemic uncertainty is the model&rsquo;s own ignorance and justifies
            abstention. Aleatoric uncertainty is irreducible ambiguity in the
            film and does not. Highest epistemic here is{" "}
            {uncertaintyLabel(Math.max(...withUncertainty.map((f) => f.epistemic)))}.
          </p>
        </div>
      )}

      <CoveragePlot
        coverage={
          cal?.fitted
            ? Object.entries(cal.thresholds).map(([k, v]) => ({
                label: k.replace(/_/g, " "),
                // Realised coverage comes from the evaluation notebook; until
                // that artefact exists the threshold is all we can honestly
                // show, so the plot renders its empty state instead.
                value: v.probability_threshold,
                n: v.n_calibration_positives,
              }))
            : []
        }
        target={cal?.coverage_target ?? 0.9}
      />

      {cal?.fitted && (
        <div
          className="rounded-sm border px-4 py-2"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <p className="py-2 text-xs text-[var(--film-mid)]">
            Calibrated thresholds — {(cal.coverage_target * 100).toFixed(0)}% nominal
            coverage
          </p>
          {Object.entries(cal.thresholds).slice(0, 14).map(([k, v]) => (
            <Row
              key={k}
              k={k.replace(/_/g, " ")}
              v={`τ ${v.probability_threshold.toFixed(3)} · n=${v.n_calibration_positives}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Fairness() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fairness()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-[var(--film-mid)]">Loading…</p>;

  const gaps = (data?.gaps as { stratum: string; tpr_gap: number; fpr_gap: number }[]) ?? [];
  const tolerance = (data?.tolerance as number) ?? 0.1;

  return (
    <div className="space-y-4">
      <FairnessBars gaps={gaps} tolerance={tolerance} />

      {!data?.available && (
        <p
          className="rounded-sm border px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--film-shoulder)", color: "var(--film-mid)" }}
        >
          Learning outcome E is assessed only in the final project, so this is a
          graded surface rather than an appendix. When the audit has not been run
          the system says so, instead of showing invented numbers.
        </p>
      )}

      {Boolean(data?.available) && (
        <details
          className="rounded-sm border p-3"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <summary className="cursor-pointer text-[11px] text-[var(--film-mid)]">
            Raw audit output
          </summary>
          <pre className="tabular mt-2 overflow-x-auto text-[10px] text-[var(--film-mid)]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function Report({ study }: { study: Study }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {/* Rendered off-screen; the print stylesheet is what reveals it. */}
      <div className="print-root">
        <PrintableReport study={study} />
      </div>

      <div className="flex items-center gap-2">
        <span className="tabular text-[11px] text-[var(--film-mid)]">
          SOURCE: {(study.report_source || "—").toUpperCase()}
        </span>
        <button
          onClick={() => window.print()}
          className="rounded-sm px-2.5 py-1 text-[11px] font-medium"
          style={{ background: "var(--instrument)", color: "#fff" }}
        >
          Export PDF
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(study.report_text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="ml-auto rounded-sm border px-2.5 py-1 text-[11px] text-[var(--film-mid)]"
          style={{ borderColor: "var(--film-shoulder)" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-sm border p-4 text-xs leading-relaxed whitespace-pre-wrap"
        style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
      >
        {study.report_text || "No report generated."}
      </pre>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-sm border border-dashed p-6 text-center"
      style={{ borderColor: "var(--film-shoulder)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-xs text-[var(--film-mid)]">{body}</p>
    </div>
  );
}
