"use client";

import { useMemo } from "react";
import type { Study } from "@/lib/types";
import { ChartEmpty, ChartFrame, INK, SERIES } from "./primitives";

/* ── Throughput over time ───────────────────────────────────────────────
   Change over time -> a line. Area fill beneath because the quantity is a
   count from a zero baseline, where the enclosed area is meaningful.
   ─────────────────────────────────────────────────────────────────────── */
export function ThroughputChart({ studies }: { studies: Study[] }) {
  const bins = useMemo(() => {
    if (!studies.length) return [];
    const now = Date.now();
    const HOURS = 12;
    const out = Array.from({ length: HOURS }, (_, i) => ({
      hour: HOURS - 1 - i,
      count: 0,
      abstained: 0,
    })).reverse();
    studies.forEach((s) => {
      const age = (now - new Date(s.created_at).getTime()) / 3_600_000;
      const idx = HOURS - 1 - Math.floor(age);
      if (idx >= 0 && idx < HOURS) {
        out[idx].count += 1;
        if (s.abstained) out[idx].abstained += 1;
      }
    });
    return out;
  }, [studies]);

  if (!bins.length)
    return <ChartEmpty title="No throughput yet" body="Analyse a study to start the timeline." />;

  const max = Math.max(...bins.map((b) => b.count), 1);
  const W = 420, H = 120, padB = 18;
  const sx = (i: number) => (i / (bins.length - 1)) * W;
  const sy = (v: number) => (H - padB) * (1 - v / max);

  const line = bins.map((b, i) => `${i ? "L" : "M"}${sx(i)},${sy(b.count)}`).join(" ");
  const area = `${line} L${W},${H - padB} L0,${H - padB} Z`;

  return (
    <ChartFrame title="Throughput" subtitle="Studies analysed per hour, last 12 hours">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Studies analysed per hour">
        <defs>
          <linearGradient id="thr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke={INK.grid} strokeWidth={1} />
        <path d={area} fill="url(#thr)" />
        <path d={line} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {bins.map((b, i) => (
          <g key={i}>
            <circle cx={sx(i)} cy={sy(b.count)} r={5} fill="var(--film-panel)" />
            <circle cx={sx(i)} cy={sy(b.count)} r={3} fill={SERIES[0]}>
              <title>{`${b.count} studies, ${b.abstained} abstained`}</title>
            </circle>
          </g>
        ))}
        <text x={0} y={H - 4} fontSize={9} fill={INK.secondary}>12h ago</text>
        <text x={W} y={H - 4} fontSize={9} textAnchor="end" fill={INK.secondary}>now</text>
      </svg>
    </ChartFrame>
  );
}

/* ── Per-pathology detection profile ────────────────────────────────────
   A radar would imply the 14 axes are commensurable and ordered, which they
   are not. A ranked bar list is the honest form for "how often does each
   label fire", and it stays readable at 14 categories.
   ─────────────────────────────────────────────────────────────────────── */
export function PathologyProfile({
  studies,
  onSelect,
  selected,
}: {
  studies: Study[];
  onSelect?: (pathology: string | null) => void;
  selected?: string | null;
}) {
  const rows = useMemo(() => {
    const acc = new Map<string, { n: number; sum: number }>();
    studies
      .filter((s) => s.status === "complete")
      .forEach((s) =>
        s.findings.forEach((f) => {
          const e = acc.get(f.display_name) ?? { n: 0, sum: 0 };
          if (f.included) e.n += 1;
          e.sum += f.probability;
          acc.set(f.display_name, e);
        }),
      );
    return [...acc.entries()]
      .map(([name, v]) => ({ name, hits: v.n, mean: v.sum / Math.max(studies.length, 1) }))
      .sort((a, b) => b.hits - a.hits || b.mean - a.mean)
      .slice(0, 10);
  }, [studies]);

  if (!rows.length)
    return <ChartEmpty title="No findings yet" body="The detection profile builds as studies are analysed." />;

  const max = Math.max(...rows.map((r) => r.hits), 1);
  const rowH = 20, padL = 122, W = 400;

  return (
    <ChartFrame
      title="Detection profile"
      subtitle="How often each pathology enters the prediction set. Click a row to filter the dashboard."
    >
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${rows.length * rowH + 6}`}
        role="img"
        aria-label="Number of studies in which each pathology entered the prediction set"
      >
        {rows.map((r, i) => {
          const y = i * rowH;
          const w = (r.hits / max) * (W - padL - 26);
          const isSel = selected === r.name;
          return (
            <g
              key={r.name}
              style={{ cursor: onSelect ? "pointer" : "default" }}
              onClick={() => onSelect?.(isSel ? null : r.name)}
            >
              {/* hit target spans the row, not just the bar */}
              <rect x={0} y={y} width={W} height={rowH} fill="transparent" />
              <text
                x={padL - 8}
                y={y + rowH / 2 + 3}
                fontSize={9.5}
                textAnchor="end"
                fill={isSel ? INK.primary : INK.secondary}
              >
                {r.name}
              </text>
              <rect
                x={padL}
                y={y + 5}
                width={Math.max(w, 2)}
                height={rowH - 10}
                rx={4}
                fill={SERIES[0]}
                opacity={selected && !isSel ? 0.3 : 1}
              >
                <title>{`${r.name}: in ${r.hits} prediction sets — click to filter`}</title>
              </rect>
              <text
                x={padL + w + 6}
                y={y + rowH / 2 + 3}
                fontSize={9}
                fill={INK.secondary}
                className="tabular"
              >
                {r.hits}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/* ── Recent activity ─────────────────────────────────────────────────── */
export function ActivityFeed({
  studies,
  onOpen,
}: {
  studies: Study[];
  onOpen?: (id: string) => void;
}) {
  const items = useMemo(
    () =>
      [...studies]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 8),
    [studies],
  );

  if (!items.length)
    return <ChartEmpty title="No activity" body="Analysed studies appear here as they complete." />;

  return (
    <ChartFrame title="Recent activity" subtitle="Newest first. Click any study to open it in the console.">
      <ol className="space-y-2">
        {items.map((s) => {
          const label = s.is_ood
            ? "rejected at the gate"
            : s.abstained
              ? "abstained — routed to a human"
              : s.findings.find((f) => f.included)?.display_name ?? "no finding above threshold";
          const color = s.is_ood
            ? "var(--stat)"
            : s.abstained
              ? "var(--urgent)"
              : SERIES[0];
          return (
            <li key={s.id}>
              <button
                onClick={() => onOpen?.(s.id)}
                disabled={!onOpen}
                className="flex w-full items-center gap-2.5 rounded-sm px-1 py-0.5 text-left enabled:hover:bg-[var(--film-base)]"
              >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="tabular w-20 shrink-0 truncate text-[11px]">{s.patient_ref || "—"}</span>
              <span className="flex-1 truncate text-[11px]" style={{ color: INK.secondary }}>
                {label}
              </span>
              <span className="tabular shrink-0 text-[10px]" style={{ color: INK.secondary }}>
                {s.latency_ms}ms
              </span>
              </button>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

/* ── Abstention breakdown ─────────────────────────────────────────────── */
export function DecisionSplit({
  studies,
  onSelect,
  selected,
}: {
  studies: Study[];
  onSelect?: (decision: string | null) => void;
  selected?: string | null;
}) {
  const { answered, abstained, rejected, total } = useMemo(() => {
    const rejected = studies.filter((s) => s.is_ood).length;
    const abstained = studies.filter((s) => s.abstained).length;
    const answered = studies.filter((s) => s.status === "complete" && !s.abstained).length;
    return { answered, abstained, rejected, total: studies.length };
  }, [studies]);

  if (!total)
    return <ChartEmpty title="No decisions yet" body="This splits studies by what the system chose to do." />;

  const segs = [
    { label: "Answered", n: answered, color: SERIES[0] },
    { label: "Abstained", n: abstained, color: "var(--urgent)" },
    { label: "Rejected", n: rejected, color: "var(--stat)" },
  ].filter((s) => s.n > 0);

  return (
    <ChartFrame
      title="What the system decided"
      subtitle="Declining to answer is an outcome, not a failure"
      legend={segs.map((s) => ({ label: `${s.label} (${s.n})`, color: s.color }))}
    >
      <div className="flex h-8 gap-0.5 overflow-hidden rounded-sm">
        {segs.map((s) => (
          <button
            key={s.label}
            onClick={() => onSelect?.(selected === s.label ? null : s.label)}
            disabled={!onSelect}
            className="grid place-items-center transition-opacity"
            style={{
              width: `${(s.n / total) * 100}%`,
              background: s.color,
              minWidth: 28,
              opacity: selected && selected !== s.label ? 0.35 : 1,
            }}
            title={`${s.label}: ${s.n} of ${total}${onSelect ? " — click to filter" : ""}`}
          >
            <span className="tabular text-[10px] font-semibold" style={{ color: "#0B0D0E" }}>
              {Math.round((s.n / total) * 100)}%
            </span>
          </button>
        ))}
      </div>
    </ChartFrame>
  );
}
