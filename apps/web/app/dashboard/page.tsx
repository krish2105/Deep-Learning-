"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CoveragePlot,
  FairnessBars,
  TriageDonut,
} from "@/components/charts/ClinicalCharts";
import { ChartFrame, INK, SERIES } from "@/components/charts/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, auth } from "@/lib/api";
import type { CalibrationState, ReadyState, Study, User } from "@/lib/types";

/**
 * Analytics overview.
 *
 * The console answers "what is wrong with THIS patient". This answers "what is
 * this system doing, and can I trust it" — the question a reviewer actually
 * arrives with. Model health is given equal weight to throughput, because a
 * dashboard that reports volume while concealing that the coverage guarantee
 * is not in force would be misleading in exactly the way this project argues
 * against.
 */
export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [cal, setCal] = useState<CalibrationState | null>(null);
  const [fairness, setFairness] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!auth.get()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me);
        const [s, r, c, f] = await Promise.allSettled([
          api.studies(),
          api.ready(),
          api.calibration(),
          api.fairness(),
        ]);
        if (s.status === "fulfilled") setStudies(s.value);
        if (r.status === "fulfilled") setReady(r.value);
        if (c.status === "fulfilled") setCal(c.value);
        if (f.status === "fulfilled") setFairness(f.value);
      } catch {
        auth.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const done = studies.filter((s) => s.status === "complete");
    const counts = { STAT: 0, URGENT: 0, ROUTINE: 0 };
    done.forEach((s) => {
      counts[s.triage_priority] = (counts[s.triage_priority] ?? 0) + 1;
    });
    const latencies = done.map((s) => s.latency_ms).filter(Boolean).sort((a, b) => a - b);
    return {
      total: studies.length,
      counts,
      abstained: done.filter((s) => s.abstained).length,
      rejected: studies.filter((s) => s.is_ood).length,
      medianLatency: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
      reduced: done.filter((s) => s.mode === "reduced").length,
      abstentionRate: done.length ? done.filter((s) => s.abstained).length / done.length : 0,
    };
  }, [studies]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="tabular text-xs tracking-widest text-[var(--film-mid)]">LOADING</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-sm">Sign in to view the dashboard</p>
          <Link
            href="/console"
            className="mt-4 inline-block rounded-sm px-4 py-2 text-sm font-medium"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            Open the console
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header
        className="flex flex-wrap items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--film-shoulder)" }}
      >
        <Link href="/" className="tabular text-sm font-semibold tracking-[0.12em]">
          SENTINEL<span style={{ color: "var(--instrument)" }}>·</span>CXR
        </Link>
        <nav className="flex gap-1 text-xs">
          <span
            className="rounded-sm px-2.5 py-1"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            Dashboard
          </span>
          <Link href="/console" className="rounded-sm px-2.5 py-1 text-[var(--film-mid)]">
            Console
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-[var(--film-mid)] sm:inline">
            {user.full_name || user.email}
            {user.role === "demo" && " · demo sandbox"}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-5">
        {/* ── KPI row ─────────────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Studies analysed" value={String(stats.total)} />
          <Stat
            label="Abstention rate"
            value={`${(stats.abstentionRate * 100).toFixed(0)}%`}
            note="Declining to answer is a feature, not a failure"
            accent={SERIES[1]}
          />
          <Stat
            label="Rejected at the gate"
            value={String(stats.rejected)}
            note="Not chest radiographs"
          />
          <Stat
            label="Median latency"
            value={stats.medianLatency ? `${stats.medianLatency} ms` : "—"}
            note={stats.reduced ? `${stats.reduced} served by the fast path` : undefined}
          />
        </section>

        {/* ── model health: the honest bit ────────────────────────────── */}
        <section
          className="rounded-sm border p-4"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <h2 className="text-sm font-medium">Model health</h2>
          <p className="mt-0.5 text-[11px] text-[var(--film-mid)]">
            What this system can and cannot currently claim.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Health
              label="Inference path"
              ok={ready?.mode === "full"}
              value={ready?.mode === "full" ? "Full" : "Reduced"}
              detail={
                ready?.mode === "full"
                  ? "Ensemble, uncertainty and Grad-CAM available"
                  : "Inference core cold — ONNX fast path only"
              }
            />
            <Health
              label="Coverage guarantee"
              ok={Boolean(cal?.fitted)}
              value={cal?.fitted ? "In force" : "Not in force"}
              detail={
                cal?.fitted
                  ? `Calibrated at ${(cal.coverage_target * 100).toFixed(0)}% nominal`
                  : "Uncalibrated defaults — run notebook 02"
              }
            />
            <Health
              label="OOD gate"
              ok={false}
              value="Untrained"
              detail="VAE weights absent — run notebook 06"
            />
            <Health
              label="Triage policy"
              ok={ready?.triage_policy === "dqn"}
              value={ready?.triage_policy === "dqn" ? "Learned (DQN)" : "Heuristic"}
              detail={
                ready?.triage_policy === "dqn"
                  ? "Trained policy in use"
                  : "Documented clinical prior — never random"
              }
            />
          </div>
        </section>

        {/* ── charts ──────────────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-2">
          <TriageDonut counts={stats.counts} />

          <ChartFrame
            title="Worklist"
            subtitle="Ordered by triage score, not arrival time"
          >
            <ol className="space-y-1.5">
              {studies
                .filter((s) => s.status === "complete")
                .sort((a, b) => b.triage_score - a.triage_score)
                .slice(0, 6)
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-3 w-1 rounded-full"
                      style={{
                        background:
                          s.triage_priority === "STAT"
                            ? "var(--stat)"
                            : s.triage_priority === "URGENT"
                              ? "var(--urgent)"
                              : "var(--film-mid)",
                      }}
                    />
                    <span className="tabular w-16 text-[10px] tracking-wider" style={{ color: INK.secondary }}>
                      {s.triage_priority}
                    </span>
                    <span className="tabular flex-1 truncate text-[11px]">{s.patient_ref || "—"}</span>
                    <span className="truncate text-[11px]" style={{ color: INK.secondary }}>
                      {s.abstained ? "abstained" : s.findings.find((f) => f.included)?.display_name ?? "no finding"}
                    </span>
                    <span className="tabular text-[11px]" style={{ color: INK.secondary }}>
                      {s.triage_score.toFixed(3)}
                    </span>
                  </li>
                ))}
              {!studies.length && (
                <li className="text-[11px]" style={{ color: INK.secondary }}>
                  No studies yet.
                </li>
              )}
            </ol>
          </ChartFrame>

          <CoveragePlot
            coverage={
              cal?.fitted
                ? Object.entries(cal.thresholds)
                    .slice(0, 8)
                    .map(([k, v]) => ({
                      label: k.replace(/_/g, " "),
                      value: v.probability_threshold,
                      n: v.n_calibration_positives,
                    }))
                : []
            }
            target={cal?.coverage_target ?? 0.9}
          />

          <FairnessBars
            gaps={
              (fairness?.gaps as { stratum: string; tpr_gap: number; fpr_gap: number }[]) ?? []
            }
            tolerance={(fairness?.tolerance as number) ?? 0.1}
          />
        </section>

        <p className="pb-6 text-[10px] text-[var(--film-mid)]">
          Research prototype for MAIB AI 114. Not a medical device. Every output
          requires radiologist review.
        </p>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-sm border p-4"
      style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
    >
      <p className="text-[11px]" style={{ color: INK.secondary }}>
        {label}
      </p>
      <p
        className="tabular mt-1.5 text-3xl font-semibold"
        style={{ color: accent ?? INK.primary }}
      >
        {value}
      </p>
      {note && (
        <p className="mt-1 text-[10px]" style={{ color: INK.secondary }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Health({
  label,
  ok,
  value,
  detail,
}: {
  label: string;
  ok: boolean;
  value: string;
  detail: string;
}) {
  return (
    <div
      className="rounded-sm border p-3"
      style={{ borderColor: "var(--film-shoulder)" }}
    >
      <div className="flex items-center gap-1.5">
        {/* status is never colour-alone: the word carries it too */}
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ background: ok ? SERIES[0] : "var(--urgent)" }}
        />
        <span className="text-[10px] tracking-wider" style={{ color: INK.secondary }}>
          {label.toUpperCase()}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium">{value}</p>
      <p className="mt-0.5 text-[10px]" style={{ color: INK.secondary }}>
        {detail}
      </p>
    </div>
  );
}
