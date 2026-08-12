"use client";

import { useMemo, useState } from "react";
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


/* ── Audit table ────────────────────────────────────────────────────────
   Sortable, searchable, exportable. An audit surface that cannot be
   interrogated is a screenshot, not a record.
   ─────────────────────────────────────────────────────────────────────── */
type SortKey = "patient" | "decision" | "triage" | "latency" | "created";

export function AuditTable({
  studies,
  onOpen,
}: {
  studies: Study[];
  onOpen?: (id: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("created");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");

  const decision = (s: Study) =>
    s.is_ood ? "rejected" : s.abstained ? "abstained" : "answered";

  const rows = useMemo(() => {
    const filtered = studies.filter((s) => {
      if (!q.trim()) return true;
      const hay = `${s.patient_ref} ${decision(s)} ${s.triage_priority} ${s.findings
        .filter((f) => f.included)
        .map((f) => f.display_name)
        .join(" ")}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
    // Triage sorts by clinical severity, not alphabetically — ROUTINE would
    // otherwise sort above STAT, which is exactly backwards for this column.
    const rank = { STAT: 0, URGENT: 1, ROUTINE: 2 } as Record<string, number>;
    const cmp: Record<SortKey, (a: Study, b: Study) => number> = {
      patient: (a, b) => (a.patient_ref || "").localeCompare(b.patient_ref || ""),
      decision: (a, b) => decision(a).localeCompare(decision(b)),
      triage: (a, b) => rank[a.triage_priority] - rank[b.triage_priority],
      latency: (a, b) => a.latency_ms - b.latency_ms,
      created: (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    };
    return [...filtered].sort((a, b) => (asc ? 1 : -1) * cmp[sort](a, b));
  }, [studies, sort, asc, q]);

  function exportCsv() {
    const head = ["patient_ref", "visit", "decision", "triage", "score", "mode", "latency_ms", "findings", "created_at"];
    const body = rows.map((s) => [
      s.patient_ref,
      s.follow_up_index + 1,
      decision(s),
      s.triage_priority,
      s.triage_score.toFixed(4),
      s.mode,
      s.latency_ms,
      // Quote the field: pathology lists contain commas and would otherwise
      // shift every subsequent column.
      `"${s.findings.filter((f) => f.included).map((f) => f.display_name).join("; ")}"`,
      s.created_at,
    ]);
    const csv = [head.join(","), ...body.map((r) => r.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinel-cxr-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const COLS: [SortKey, string][] = [
    ["patient", "Patient"],
    ["decision", "Decision"],
    ["triage", "Triage"],
    ["latency", "Latency"],
    ["created", "When"],
  ];

  return (
    <ChartFrame
      title="Audit record"
      subtitle={`${rows.length} of ${studies.length} studies. Click a column to sort, a row to open it.`}
      action={
        <div className="flex items-center gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search the audit record"
            className="w-28 rounded-sm border px-2 py-1 text-[11px] outline-none"
            style={{
              borderColor: "var(--film-shoulder)",
              background: "var(--film-base)",
              color: INK.primary,
            }}
          />
          <button
            onClick={exportCsv}
            className="rounded-sm border px-2 py-1 text-[11px]"
            style={{ borderColor: "var(--film-shoulder)", color: INK.secondary }}
          >
            CSV
          </button>
        </div>
      }
    >
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0" style={{ background: "var(--film-panel)" }}>
            <tr>
              {COLS.map(([k, label]) => (
                <th key={k} className="pb-1.5 pr-3 font-normal">
                  <button
                    onClick={() => {
                      if (sort === k) setAsc(!asc);
                      else {
                        setSort(k);
                        setAsc(false);
                      }
                    }}
                    className="flex items-center gap-1"
                    style={{ color: sort === k ? INK.primary : INK.secondary }}
                  >
                    {label}
                    <span aria-hidden style={{ opacity: sort === k ? 1 : 0.25 }}>
                      {sort === k && asc ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              ))}
              <th className="pb-1.5 font-normal" style={{ color: INK.secondary }}>
                Findings
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const d = decision(s);
              return (
                <tr
                  key={s.id}
                  onClick={() => onOpen?.(s.id)}
                  className={onOpen ? "cursor-pointer hover:bg-[var(--film-base)]" : ""}
                  style={{ borderTop: "1px solid var(--film-shoulder)" }}
                >
                  <td className="tabular py-1.5 pr-3">
                    {s.patient_ref || "—"}
                    <span style={{ color: INK.secondary }}> ·{s.follow_up_index + 1}</span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      style={{
                        color:
                          d === "rejected"
                            ? "var(--stat)"
                            : d === "abstained"
                              ? "var(--urgent)"
                              : INK.primary,
                      }}
                    >
                      {d}
                    </span>
                  </td>
                  <td className="tabular py-1.5 pr-3">{s.triage_priority}</td>
                  <td className="tabular py-1.5 pr-3">{s.latency_ms}ms</td>
                  <td className="tabular py-1.5 pr-3" style={{ color: INK.secondary }}>
                    {new Date(s.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="truncate py-1.5" style={{ color: INK.secondary, maxWidth: 180 }}>
                    {s.findings.filter((f) => f.included).map((f) => f.display_name).join(", ") || "—"}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-3" style={{ color: INK.secondary }}>
                  {q ? `Nothing matches "${q}".` : "No studies in this session."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
