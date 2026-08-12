"use client";

import { useMemo } from "react";
import type { PathologyFinding, Study } from "@/lib/types";
import { chromaColor } from "@/lib/utils";
import {
  ChartEmpty,
  ChartFrame,
  Grid,
  HatchDef,
  INK,
  SERIES,
  Tooltip,
  useChartId,
  useTooltip,
} from "./primitives";

/* ══════════════════════════════════════════════════════════════════════
   1. Pathology probabilities with conformal thresholds

   Magnitude against a per-category threshold, so: ranked horizontal bars.
   Horizontal because fourteen pathology names cannot be read on a vertical
   axis without rotating them.

   This is a single-measure chart, so it uses ONE hue and varies saturation by
   confidence — the same confidence-as-chroma mechanic as the rest of the
   interface, rather than fourteen cycled categorical colours (which would
   imply fourteen unrelated series).
   ══════════════════════════════════════════════════════════════════════ */
export function ProbabilityBars({ findings }: { findings: PathologyFinding[] }) {
  const id = useChartId();
  const { tip, setTip } = useTooltip<PathologyFinding>();

  const rows = useMemo(
    () => [...findings].sort((a, b) => b.probability - a.probability),
    [findings],
  );
  if (!rows.length)
    return <ChartEmpty title="No findings" body="Analyse a study to populate this chart." />;

  const rowH = 22;
  const padLeft = 128;
  const width = 420;
  const height = rows.length * rowH;

  return (
    <ChartFrame
      title="Pathology probabilities"
      subtitle="Ranked, with each label's calibrated conformal threshold marked in place"
      legend={[
        { label: "In prediction set", color: SERIES[0] },
        { label: "Below threshold", color: "var(--film-mid)" },
        { label: "Conformal threshold τ", color: INK.primary },
      ]}
    >
      <div className="relative overflow-x-auto">
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height + 22}`}
          role="img"
          aria-label={`Probabilities for ${rows.length} pathologies against their conformal thresholds`}
        >
          <HatchDef id={`h-${id}`} color="var(--film-mid)" />
          <Grid
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            width={width}
            height={height}
            padLeft={padLeft}
            format={(v) => v.toFixed(2)}
          />

          {rows.map((f, i) => {
            const y = i * rowH;
            const scale = (v: number) => padLeft + v * (width - padLeft);
            const barW = Math.max(scale(f.probability) - padLeft, 2);
            const tx = scale(f.threshold);
            const fill = f.included ? chromaColor(f.chroma) : "var(--film-mid)";

            return (
              <g
                key={f.name}
                onMouseEnter={(e) =>
                  setTip({
                    x: e.nativeEvent.offsetX,
                    y: e.nativeEvent.offsetY,
                    datum: f,
                  })
                }
                onMouseLeave={() => setTip(null)}
              >
                {/* hit target larger than the mark */}
                <rect x={0} y={y} width={width} height={rowH} fill="transparent" />

                <text
                  x={padLeft - 8}
                  y={y + rowH / 2 + 3}
                  fontSize={10}
                  textAnchor="end"
                  fill={f.included ? INK.primary : INK.secondary}
                >
                  {f.display_name}
                </text>

                {/* 4px rounded data-end, anchored to the baseline */}
                <rect
                  x={padLeft}
                  y={y + 6}
                  width={barW}
                  height={rowH - 12}
                  rx={4}
                  fill={f.included ? fill : `url(#h-${id})`}
                  opacity={f.included ? 1 : 0.75}
                />

                {/* threshold marker, with a 2px surface ring so it stays
                    legible where it overlaps the bar */}
                <line
                  x1={tx}
                  x2={tx}
                  y1={y + 3}
                  y2={y + rowH - 3}
                  stroke="var(--film-panel)"
                  strokeWidth={3.5}
                />
                <line
                  x1={tx}
                  x2={tx}
                  y1={y + 3}
                  y2={y + rowH - 3}
                  stroke={INK.primary}
                  strokeWidth={1.5}
                  opacity={0.85}
                />

                {/* direct-label only what is in the set — never every point */}
                {f.included && (
                  <text
                    x={padLeft + barW + 6}
                    y={y + rowH / 2 + 3}
                    fontSize={9.5}
                    fill={INK.primary}
                    className="tabular"
                  >
                    {f.probability.toFixed(3)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {tip && (
          <Tooltip x={tip.x} y={tip.y} width={200}>
            <div className="font-medium">{tip.datum.display_name}</div>
            <div className="tabular mt-1" style={{ color: INK.secondary }}>
              p {tip.datum.probability.toFixed(4)} · τ {tip.datum.threshold.toFixed(3)}
              <br />
              margin {tip.datum.margin >= 0 ? "+" : ""}
              {tip.datum.margin.toFixed(4)}
              <br />
              {tip.datum.included ? "in prediction set" : "below threshold"}
            </div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2. Uncertainty decomposition

   Two components of one total, per pathology — a stacked bar. Two categories
   only, so two categorical hues, with a 2px surface gap between segments so
   the boundary is legible without a stroke.

   The distinction is the point: epistemic is the model's ignorance and is what
   justifies abstention; aleatoric is irreducible ambiguity in the image and
   does not.
   ══════════════════════════════════════════════════════════════════════ */
export function UncertaintyStack({ findings }: { findings: PathologyFinding[] }) {
  const { tip, setTip } = useTooltip<PathologyFinding>();

  const rows = useMemo(
    () =>
      [...findings]
        .filter((f) => f.epistemic > 0 || f.aleatoric > 0)
        .sort((a, b) => b.epistemic + b.aleatoric - (a.epistemic + a.aleatoric))
        .slice(0, 8),
    [findings],
  );

  if (!rows.length)
    return (
      <ChartEmpty
        title="No uncertainty decomposition"
        body="Requires the full inference path. This study was served by the ONNX fast path, which does not sample."
      />
    );

  const max = Math.max(...rows.map((f) => f.epistemic + f.aleatoric), 0.1);
  const rowH = 26;
  const padLeft = 128;
  const width = 420;
  const height = rows.length * rowH;

  return (
    <ChartFrame
      title="Uncertainty decomposition"
      subtitle="Epistemic uncertainty is the model's own ignorance and justifies abstention; aleatoric is irreducible ambiguity in the image and does not"
      legend={[
        { label: "Epistemic (model ignorance)", color: SERIES[1] },
        { label: "Aleatoric (image ambiguity)", color: SERIES[2] },
      ]}
    >
      <div className="relative overflow-x-auto">
        <svg width="100%" viewBox={`0 0 ${width} ${height + 22}`} role="img"
             aria-label="Epistemic and aleatoric uncertainty per pathology, in nats">
          <Grid
            ticks={[0, 0.5, 1]}
            width={width}
            height={height}
            padLeft={padLeft}
            format={(v) => (v * max).toFixed(2)}
          />
          {rows.map((f, i) => {
            const y = i * rowH;
            const span = width - padLeft;
            const wE = (f.epistemic / max) * span;
            const wA = (f.aleatoric / max) * span;
            return (
              <g
                key={f.name}
                onMouseEnter={(e) =>
                  setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, datum: f })
                }
                onMouseLeave={() => setTip(null)}
              >
                <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
                <text x={padLeft - 8} y={y + rowH / 2 + 3} fontSize={10} textAnchor="end" fill={INK.secondary}>
                  {f.display_name}
                </text>
                <rect x={padLeft} y={y + 7} width={Math.max(wE, 1)} height={rowH - 14} rx={4} fill={SERIES[1]} />
                {/* 2px surface gap between segments */}
                <rect x={padLeft + wE + 2} y={y + 7} width={Math.max(wA - 2, 1)} height={rowH - 14} rx={4} fill={SERIES[2]} />
              </g>
            );
          })}
        </svg>
        {tip && (
          <Tooltip x={tip.x} y={tip.y} width={196}>
            <div className="font-medium">{tip.datum.display_name}</div>
            <div className="tabular mt-1" style={{ color: INK.secondary }}>
              epistemic {tip.datum.epistemic.toFixed(4)}
              <br />
              aleatoric {tip.datum.aleatoric.toFixed(4)}
              <br />
              dominant: {tip.datum.dominant_uncertainty}
            </div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   3. Progression across visits

   Change over time → lines. Categorical hues by pathology, assigned in fixed
   order so a pathology keeps its colour when the filter changes the series
   count. Colour follows the entity, never its rank.
   ══════════════════════════════════════════════════════════════════════ */
export function ProgressionChart({ studies }: { studies: Study[] }) {
  const series = useMemo(() => {
    const ordered = [...studies]
      .filter((s) => s.status === "complete")
      .sort((a, b) => a.follow_up_index - b.follow_up_index);
    if (ordered.length < 2) return null;

    const names = new Set<string>();
    ordered.forEach((s) =>
      s.findings.filter((f) => f.included || f.probability > 0.3).forEach((f) => names.add(f.name)),
    );

    return [...names]
      .slice(0, 5)
      .map((name, i) => ({
        name,
        display: ordered[0].findings.find((f) => f.name === name)?.display_name ?? name,
        color: SERIES[i % SERIES.length],
        points: ordered.map((s, x) => ({
          x,
          y: s.findings.find((f) => f.name === name)?.probability ?? 0,
          ref: s.patient_ref,
        })),
      }));
  }, [studies]);

  if (!series)
    return (
      <ChartEmpty
        title="Needs at least two studies"
        body="Upload a second study with the same patient reference to plot a trajectory across visits."
      />
    );

  const width = 420;
  const height = 170;
  const padL = 34;
  const padB = 22;
  const n = series[0].points.length;
  const sx = (x: number) => padL + (n === 1 ? 0 : (x / (n - 1)) * (width - padL - 12));
  const sy = (y: number) => (1 - y) * (height - padB);

  return (
    <ChartFrame
      title="Progression across visits"
      subtitle="Per-pathology probability at each follow-up. This is observed change, not the recurrent model's forecast."
      legend={series.map((s) => ({ label: s.display, color: s.color }))}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Pathology probability trajectories across follow-up studies">
        {[0, 0.5, 1].map((t) => (
          <g key={t} aria-hidden>
            <line x1={padL} x2={width} y1={sy(t)} y2={sy(t)} stroke={INK.grid} strokeWidth={1} opacity={0.55} />
            <text x={padL - 6} y={sy(t) + 3} fontSize={9} textAnchor="end" fill={INK.secondary} className="tabular">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {series[0].points.map((p, i) => (
          <text key={i} x={sx(i)} y={height - 4} fontSize={9} textAnchor="middle" fill={INK.secondary}>
            visit {i + 1}
          </text>
        ))}

        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.points.map((p, i) => (
              <g key={i}>
                {/* 2px surface ring keeps overlapping markers separable */}
                <circle cx={sx(p.x)} cy={sy(p.y)} r={5.5} fill="var(--film-panel)" />
                <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color}>
                  <title>{`${s.display} · visit ${i + 1} · ${p.y.toFixed(3)}`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   4. Conformal coverage — empirical against nominal

   The project's central claim, plotted. A reference line at the nominal level
   with per-label points around it; the question a reader asks is "does this sit
   on the line", so the line is the subject and gets the ink.
   ══════════════════════════════════════════════════════════════════════ */
export function CoveragePlot({
  coverage,
  target,
}: {
  coverage: { label: string; value: number; n: number }[];
  target: number;
}) {
  if (!coverage.length)
    return (
      <ChartEmpty
        title="No calibration data"
        body="Run notebooks/02_cnn_classifier.ipynb and deploy conformal_calibration.json to populate empirical coverage."
      />
    );

  const width = 460;
  const height = 190;
  const padL = 108;
  const padB = 24;
  const lo = 0.6;
  const sx = (v: number) => padL + ((v - lo) / (1 - lo)) * (width - padL - 16);
  const rowH = (height - padB) / coverage.length;

  return (
    <ChartFrame
      title="Conformal coverage — empirical vs nominal"
      subtitle="The system's central claim. Each label should reach at least the nominal level."
      legend={[
        { label: "Empirical coverage", color: SERIES[0] },
        { label: `Nominal target ${(target * 100).toFixed(0)}%`, color: SERIES[3] },
      ]}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Empirical coverage per pathology against the nominal target">
        {[0.6, 0.7, 0.8, 0.9, 1.0].map((t) => (
          <g key={t} aria-hidden>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={height - padB} stroke={INK.grid} strokeWidth={1} opacity={0.5} />
            <text x={sx(t)} y={height - 8} fontSize={9} textAnchor="middle" fill={INK.secondary} className="tabular">
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* the reference line is the subject of this chart */}
        <line x1={sx(target)} x2={sx(target)} y1={0} y2={height - padB} stroke={SERIES[3]} strokeWidth={2} strokeDasharray="4 3" />

        {coverage.map((c, i) => {
          const y = i * rowH + rowH / 2;
          const ok = c.value >= target - 0.03;
          return (
            <g key={c.label}>
              <text x={padL - 8} y={y + 3} fontSize={9.5} textAnchor="end" fill={INK.secondary}>
                {c.label}
              </text>
              <line x1={padL} x2={sx(c.value)} y1={y} y2={y} stroke={INK.grid} strokeWidth={1} />
              <circle cx={sx(c.value)} cy={y} r={5.5} fill="var(--film-panel)" />
              <circle cx={sx(c.value)} cy={y} r={4} fill={ok ? SERIES[0] : SERIES[3]}>
                <title>{`${c.label}: ${(c.value * 100).toFixed(1)}% over n=${c.n}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   5. Fairness — equalised-odds gaps by stratum

   Magnitude against a hard tolerance. Bars, with the tolerance as a reference
   line. Bars that breach it take the status colour, which is reserved for
   state and never reused as a series hue — and they carry a label too, so the
   breach is never signalled by colour alone.
   ══════════════════════════════════════════════════════════════════════ */
export function FairnessBars({
  gaps,
  tolerance,
}: {
  gaps: { stratum: string; tpr_gap: number; fpr_gap: number }[];
  tolerance: number;
}) {
  if (!gaps.length)
    return (
      <ChartEmpty
        title="Fairness audit not yet run"
        body="Run notebooks/11_fairness_ethics.ipynb and deploy fairness_report.json. Learning outcome E is assessed only in this project."
      />
    );

  const width = 440;
  const barH = 16;
  const groupH = 46;
  const padL = 96;
  const height = gaps.length * groupH;
  const max = Math.max(tolerance * 1.6, ...gaps.flatMap((g) => [g.tpr_gap, g.fpr_gap]));
  const sx = (v: number) => padL + (v / max) * (width - padL - 40);

  return (
    <ChartFrame
      title="Equalised-odds gaps by stratum"
      subtitle={`Maximum within-stratum difference in true- and false-positive rate. Tolerance ${tolerance}.`}
      legend={[
        { label: "TPR gap", color: SERIES[0] },
        { label: "FPR gap", color: SERIES[4] },
        { label: `Breaches tolerance`, color: SERIES[3] },
      ]}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height + 16}`} role="img"
           aria-label="Equalised odds gaps per stratum against the tolerance threshold">
        <line x1={sx(tolerance)} x2={sx(tolerance)} y1={0} y2={height} stroke={SERIES[3]} strokeWidth={2} strokeDasharray="4 3" />
        <text x={sx(tolerance)} y={height + 12} fontSize={9} textAnchor="middle" fill={INK.secondary} className="tabular">
          τ {tolerance}
        </text>

        {gaps.map((g, i) => {
          const y = i * groupH;
          return (
            <g key={g.stratum}>
              <text x={padL - 8} y={y + groupH / 2} fontSize={10} textAnchor="end" fill={INK.primary}>
                {g.stratum}
              </text>
              {[
                { v: g.tpr_gap, c: SERIES[0], label: "TPR" },
                { v: g.fpr_gap, c: SERIES[4], label: "FPR" },
              ].map((row, j) => {
                const by = y + 4 + j * (barH + 2); // 2px surface gap between bars
                const breach = row.v > tolerance;
                return (
                  <g key={row.label}>
                    <rect
                      x={padL}
                      y={by}
                      width={Math.max(sx(row.v) - padL, 2)}
                      height={barH}
                      rx={4}
                      fill={breach ? SERIES[3] : row.c}
                    >
                      <title>{`${g.stratum} ${row.label} gap ${row.v.toFixed(3)}${breach ? " — breaches tolerance" : ""}`}</title>
                    </rect>
                    <text x={sx(row.v) + 6} y={by + barH - 4} fontSize={9} fill={INK.secondary} className="tabular">
                      {row.v.toFixed(3)}
                      {breach ? " !" : ""}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   6. Triage distribution — a donut only because it is one part-to-whole
      with three categories. Anything more and this would be a bar chart.
   ══════════════════════════════════════════════════════════════════════ */
export function TriageDonut({
  counts,
  onSelect,
  selected,
}: {
  counts: { STAT: number; URGENT: number; ROUTINE: number };
  onSelect?: (band: string | null) => void;
  selected?: string | null;
}) {
  const total = counts.STAT + counts.URGENT + counts.ROUTINE;
  const slices = [
    { label: "STAT", value: counts.STAT, color: "var(--stat)" },
    { label: "URGENT", value: counts.URGENT, color: "var(--urgent)" },
    { label: "ROUTINE", value: counts.ROUTINE, color: "var(--film-mid)" },
  ];

  if (!total)
    return <ChartEmpty title="Empty worklist" body="Analyse a study to populate the triage mix." />;

  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <ChartFrame
      title="Triage distribution"
      subtitle="Priority mix. Click a band to filter the dashboard."
      legend={slices.map((s) => ({ label: `${s.label} (${s.value})`, color: s.color }))}
    >
      <div className="flex items-center justify-center py-1">
        <svg viewBox="0 0 150 150" width={150} height={150} role="img"
             aria-label={`Triage mix: ${slices.map((s) => `${s.value} ${s.label}`).join(", ")}`}>
          <g transform="translate(75,75) rotate(-90)">
            {slices.map((s) => {
              const frac = s.value / total;
              // 2px surface gap between segments
              const dash = `${Math.max(frac * C - 2, 0)} ${C}`;
              const el = (
                <circle
                  key={s.label}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={selected === s.label ? 21 : 16}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  opacity={selected && selected !== s.label ? 0.35 : 1}
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                  onClick={() => onSelect?.(selected === s.label ? null : s.label)}
                >
                  <title>{`${s.label}: ${s.value} of ${total}${onSelect ? " — click to filter" : ""}`}</title>
                </circle>
              );
              offset += frac * C;
              return el;
            })}
          </g>
          <text x={75} y={72} textAnchor="middle" fontSize={26} fontWeight={600} fill={INK.primary} className="tabular">
            {total}
          </text>
          <text x={75} y={88} textAnchor="middle" fontSize={9} fill={INK.secondary}>
            studies
          </text>
        </svg>
      </div>
    </ChartFrame>
  );
}
