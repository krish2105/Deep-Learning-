"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CoveragePlot,
  FairnessBars,
  TriageDonut,
} from "@/components/charts/ClinicalCharts";
import {
  ActivityFeed,
  DecisionSplit,
  PathologyProfile,
  ThroughputChart,
} from "@/components/charts/DashboardCharts";
import { ChartFrame, INK, SERIES } from "@/components/charts/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, auth, offlineDemo } from "@/lib/api";
import { DEMO_STUDIES } from "@/lib/demoFixtures";
import type { CalibrationState, ReadyState, Study, User } from "@/lib/types";

const TABS = ["Overview", "Model", "Fairness", "Audit"] as const;
type Tab = (typeof TABS)[number];

/**
 * Analytics dashboard.
 *
 * The console answers "what is wrong with THIS patient". This answers "what is
 * this system doing, and can I trust it" — the question a reviewer actually
 * arrives with. Model health sits alongside throughput rather than beneath it,
 * because a dashboard that reports volume while concealing that the coverage
 * guarantee is not in force would be misleading in precisely the way this
 * project argues against.
 */
export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [cal, setCal] = useState<CalibrationState | null>(null);
  const [fairness, setFairness] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  // Cross-filter state. Clicking any chart narrows every other chart to that
  // slice, so the dashboard answers follow-up questions instead of only the
  // first one.
  const [fPriority, setFPriority] = useState<string | null>(null);
  const [fDecision, setFDecision] = useState<string | null>(null);
  const [fPathology, setFPathology] = useState<string | null>(null);
  const router = useRouter();

  const openStudy = (id: string) => router.push(`/console?study=${id}`);
  const clearFilters = () => {
    setFPriority(null);
    setFDecision(null);
    setFPathology(null);
  };
  const activeFilters = [fPriority, fDecision, fPathology].filter(Boolean).length;

  useEffect(() => {
    (async () => {
      if (offlineDemo.get()) {
        setUser({
          id: "offline-demo",
          email: "demo@sentinel-cxr.local",
          full_name: "Demo Reviewer",
          role: "demo",
          created_at: new Date(0).toISOString(),
        });
        setStudies(DEMO_STUDIES);
        setOffline(true);
        setLoading(false);
        return;
      }
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

  // Everything below reads `view`, never `studies`, so a filter applied on one
  // chart propagates everywhere without each chart knowing about the others.
  const view = useMemo(() => {
    return studies.filter((s) => {
      if (fPriority && s.triage_priority !== fPriority) return false;
      if (fDecision) {
        const d = s.is_ood ? "Rejected" : s.abstained ? "Abstained" : "Answered";
        if (d !== fDecision) return false;
      }
      if (fPathology) {
        const hit = s.findings.some((f) => f.included && f.display_name === fPathology);
        if (!hit) return false;
      }
      return true;
    });
  }, [studies, fPriority, fDecision, fPathology]);

  // Poll for new studies so the dashboard stays current without a reload.
  // 20s rather than a socket: the free tier spins down, and a dropped socket
  // that silently stops updating is worse than a visible poll.
  useEffect(() => {
    if (offline || !user) return;
    const id = setInterval(() => {
      api.studies().then(setStudies).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [offline, user]);

  const stats = useMemo(() => {
    const done = view.filter((s) => s.status === "complete");
    const counts = { STAT: 0, URGENT: 0, ROUTINE: 0 };
    done.forEach((s) => (counts[s.triage_priority] = (counts[s.triage_priority] ?? 0) + 1));
    const lat = done.map((s) => s.latency_ms).filter(Boolean).sort((a, b) => a - b);
    return {
      total: view.length,
      counts,
      rejected: view.filter((s) => s.is_ood).length,
      abstained: done.filter((s) => s.abstained).length,
      median: lat.length ? lat[Math.floor(lat.length / 2)] : 0,
      p95: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0,
      abstentionRate: done.length ? done.filter((s) => s.abstained).length / done.length : 0,
      stat: counts.STAT,
    };
  }, [view]);

  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="tabular text-xs tracking-widest text-[var(--film-mid)]">LOADING</p>
      </div>
    );

  if (!user)
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-sm">Open the demo to view the dashboard</p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-[var(--film-mid)]">
            No sign-up needed — the console issues a sandbox with five studies.
          </p>
          <Link
            href="/console"
            className="mt-5 inline-block rounded-sm px-4 py-2 text-sm font-medium"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            Open the console
          </Link>
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur-md"
        style={{
          borderColor: "var(--film-shoulder)",
          background: "color-mix(in oklab, var(--film-base) 85%, transparent)",
        }}
      >
        <Link href="/" className="tabular text-sm font-semibold tracking-[0.12em]">
          SENTINEL<span style={{ color: "var(--instrument)" }}>·</span>CXR
        </Link>
        <nav className="flex gap-1 text-xs">
          <span className="rounded-sm px-2.5 py-1" style={{ background: "var(--instrument)", color: "#fff" }}>
            Dashboard
          </span>
          <Link href="/console" className="rounded-sm px-2.5 py-1 text-[var(--film-mid)]">
            Console
          </Link>
        </nav>
        {offline && (
          <span
            className="tabular rounded-full border px-2 py-0.5 text-[10px] tracking-widest"
            style={{ borderColor: "var(--urgent)", color: "var(--urgent)" }}
          >
            OFFLINE DEMO
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-[var(--film-mid)] sm:inline">
            {user.full_name || user.email}
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* tabs */}
      <div className="border-b px-5" style={{ borderColor: "var(--film-shoulder)" }}>
        <div className="mx-auto flex max-w-6xl gap-1 py-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="rounded-sm px-3 py-1.5 text-xs transition-colors"
              style={{
                background: tab === t ? "var(--film-panel)" : "transparent",
                color: tab === t ? "var(--film-highlight)" : "var(--film-mid)",
                border: `1px solid ${tab === t ? "var(--film-shoulder)" : "transparent"}`,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeFilters > 0 && (
        <div
          className="border-b px-5 py-2"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <span className="text-[11px]" style={{ color: INK.secondary }}>
              Filtered to
            </span>
            {[
              [fPriority, () => setFPriority(null)],
              [fDecision, () => setFDecision(null)],
              [fPathology, () => setFPathology(null)],
            ]
              .filter(([v]) => v)
              .map(([v, clear]) => (
                <button
                  key={String(v)}
                  onClick={clear as () => void}
                  className="rounded-full px-2.5 py-1 text-[11px]"
                  style={{ background: "var(--instrument)", color: "#fff" }}
                >
                  {String(v)} ×
                </button>
              ))}
            <span className="tabular text-[11px]" style={{ color: INK.secondary }}>
              {view.length} of {studies.length} studies
            </span>
            <button
              onClick={clearFilters}
              className="ml-auto text-[11px] underline decoration-dotted underline-offset-4"
              style={{ color: INK.secondary }}
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-4 p-5">
        {tab === "Overview" && (
          <>
            {/* Bento: the hero block carries the number that matters most. */}
            <section className="grid gap-3 lg:grid-cols-4">
              <div
                className="rounded-sm border p-6 lg:col-span-2 lg:row-span-1"
                style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
              >
                <p className="text-[11px]" style={{ color: INK.secondary }}>
                  Abstention rate
                </p>
                <p
                  className="tabular mt-2 font-[family-name:var(--font-display)] leading-none"
                  style={{ fontSize: "var(--text-step-4)", color: SERIES[1] }}
                >
                  {(stats.abstentionRate * 100).toFixed(0)}%
                </p>
                <p className="mt-3 max-w-sm text-xs" style={{ color: INK.secondary }}>
                  The share of studies the system declined to answer. This is the
                  number the project is built around — a system that never
                  abstains is not calibrated, it is just confident.
                </p>
              </div>

              <Stat label="Studies analysed" value={String(stats.total)} />
              <Stat label="STAT priority" value={String(stats.stat)} accent="var(--stat)" note="time-critical findings" />
              <Stat label="Rejected at gate" value={String(stats.rejected)} note="not chest radiographs" />
              <Stat
                label="Median latency"
                value={stats.median ? `${stats.median} ms` : "—"}
                note={stats.p95 ? `p95 ${stats.p95} ms` : undefined}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ThroughputChart studies={view} />
              </div>
              <TriageDonut
                counts={stats.counts}
                selected={fPriority}
                onSelect={setFPriority}
              />
              <DecisionSplit
                studies={view}
                selected={fDecision}
                onSelect={setFDecision}
              />
              <div className="lg:col-span-2">
                <PathologyProfile
                  studies={view}
                  selected={fPathology}
                  onSelect={setFPathology}
                />
              </div>
              <div className="lg:col-span-3">
                <ActivityFeed studies={view} onOpen={openStudy} />
              </div>
            </section>
          </>
        )}

        {tab === "Model" && (
          <>
            <section
              className="rounded-sm border p-4"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <h2 className="text-sm font-medium">Model health</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: INK.secondary }}>
                What this system can and cannot currently claim.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Health
                  label="Inference path"
                  ok={ready?.backends.fast_path === "ready" || ready?.mode === "full"}
                  value={ready?.mode === "full" ? "Full" : ready?.backends.fast_path === "ready" ? "ONNX fast path" : "Unavailable"}
                  detail={
                    ready?.mode === "full"
                      ? "Ensemble, uncertainty and Grad-CAM available"
                      : "Real inference on the orchestrator; Grad-CAM needs the Space"
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
                  label="Storage"
                  ok={ready?.storage === "persistent"}
                  value={ready?.storage === "persistent" ? "Persistent" : "Ephemeral"}
                  detail={ready?.storage_note ?? "Set DATABASE_URL for persistence"}
                />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CoveragePlot
                coverage={
                  cal?.fitted
                    ? Object.entries(cal.thresholds).slice(0, 10).map(([k, v]) => ({
                        label: k.replace(/_/g, " "),
                        value: v.probability_threshold,
                        n: v.n_calibration_positives,
                      }))
                    : []
                }
                target={cal?.coverage_target ?? 0.9}
              />
              <PathologyProfile studies={view} />
            </section>
          </>
        )}

        {tab === "Fairness" && (
          <section className="space-y-4">
            <FairnessBars
              gaps={(fairness?.gaps as { stratum: string; tpr_gap: number; fpr_gap: number }[]) ?? []}
              tolerance={(fairness?.tolerance as number) ?? 0.1}
            />
            <div
              className="rounded-sm border p-5"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <h3 className="text-sm font-medium">What cannot be audited</h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: INK.secondary }}>
                ChestX-ray14 contains no race or ethnicity labels, so a major
                documented axis of disparity in medical AI is invisible here.
                Seyyed-Kalantari et al. (2021) found systematic underdiagnosis by
                chest radiograph classifiers in under-served populations, so this
                is not hypothetical.
              </p>
              <p className="mt-3 text-xs font-medium" style={{ color: "var(--stat)" }}>
                That absence is a finding. It is not, and must not be presented
                as, an absence of bias.
              </p>
            </div>
            <div
              className="rounded-sm border p-5"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <h3 className="text-sm font-medium">The view-position shortcut</h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: INK.secondary }}>
                Anteroposterior films are taken at the bedside of patients too
                unwell to stand, so view position correlates with severity. A
                model can learn to read &ldquo;AP film&rdquo; as &ldquo;sick
                patient&rdquo; — a shortcut that scores well in-distribution and
                fails the moment acquisition practice changes.
              </p>
            </div>
          </section>
        )}

        {tab === "Audit" && (
          <section className="space-y-4">
            <ActivityFeed studies={view} onOpen={openStudy} />
            <ChartFrame title="Every study" subtitle="Full decision record for this session">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr style={{ color: INK.secondary }}>
                      {["Patient", "Visit", "Decision", "Triage", "Mode", "Latency"].map((h) => (
                        <th key={h} className="py-1.5 pr-4 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.map((s) => (
                      <tr key={s.id} className="border-t" style={{ borderColor: "var(--film-shoulder)" }}>
                        <td className="tabular py-1.5 pr-4">{s.patient_ref || "—"}</td>
                        <td className="tabular py-1.5 pr-4">{s.follow_up_index + 1}</td>
                        <td className="py-1.5 pr-4">
                          {s.is_ood ? "rejected" : s.abstained ? "abstained" : "answered"}
                        </td>
                        <td className="tabular py-1.5 pr-4">{s.triage_priority}</td>
                        <td className="py-1.5 pr-4">{s.mode}</td>
                        <td className="tabular py-1.5 pr-4">{s.latency_ms}ms</td>
                      </tr>
                    ))}
                    {!view.length && (
                      <tr>
                        <td colSpan={6} className="py-3" style={{ color: INK.secondary }}>
                          No studies in this session.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </ChartFrame>
          </section>
        )}

        <p className="pb-6 text-[10px]" style={{ color: INK.secondary }}>
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
      <p className="text-[11px]" style={{ color: INK.secondary }}>{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold" style={{ color: accent ?? INK.primary }}>
        {value}
      </p>
      {note && <p className="mt-1 text-[10px]" style={{ color: INK.secondary }}>{note}</p>}
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
    <div className="rounded-sm border p-3" style={{ borderColor: "var(--film-shoulder)" }}>
      <div className="flex items-center gap-1.5">
        {/* status is never colour-alone — the word carries it too */}
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
      <p className="mt-0.5 text-[10px]" style={{ color: INK.secondary }}>{detail}</p>
    </div>
  );
}
