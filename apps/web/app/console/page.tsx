"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthPanel, OFFLINE_USER } from "@/components/console/Auth";
import { DEMO_STUDIES } from "@/lib/demoFixtures";
import { Panel, TABS, type Tab } from "@/components/console/Panels";
import { Viewer } from "@/components/console/Viewer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ApiError, api, auth, offlineDemo } from "@/lib/api";
import type { ReadyState, Study, User, WorklistItem } from "@/lib/types";
import { PRIORITY_COLOR, cn, formatWait } from "@/lib/utils";

/** Derive a worklist from studies, matching the server's ordering rule. */
function toWorklist(studies: Study[]): WorklistItem[] {
  const now = Date.now();
  return studies
    .filter((s) => s.status === "complete")
    .sort((a, b) => b.triage_score - a.triage_score)
    .map((s) => {
      const top = s.findings.reduce(
        (best, f) => (f.probability > best.probability ? f : best),
        s.findings[0],
      );
      return {
        id: s.id,
        patient_ref: s.patient_ref || "—",
        triage_priority: s.triage_priority,
        triage_score: s.triage_score,
        triage_rationale: s.triage_rationale,
        abstained: s.abstained,
        is_ood: s.is_ood,
        top_finding: top?.display_name ?? "—",
        top_probability: top?.probability ?? 0,
        waited_minutes: Math.max(
          0,
          (now - new Date(s.created_at).getTime()) / 60000,
        ),
        status: s.status,
        created_at: s.created_at,
      };
    });
}

/**
 * The clinical console.
 *
 * Deliberately does not use Lenis smooth scroll or scroll-linked motion. This
 * is a tool someone uses repeatedly; weighting its scroll would trade their
 * speed for our polish. Motion here is limited to state feedback.
 */
export default function Console() {
  const [user, setUser] = useState<User | null>(null);
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Restore an offline session so a page refresh or a hop to /dashboard does
    // not drop the reviewer back onto the sign-in screen.
    if (offlineDemo.get()) {
      setOffline(true);
      setUser(OFFLINE_USER);
      setChecking(false);
      return;
    }
    if (!auth.get()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => auth.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="tabular text-xs tracking-widest text-[var(--film-mid)]">
          LOADING
        </p>
      </div>
    );
  }

  if (!user)
    return (
      <AuthPanel
        onAuth={setUser}
        onOfflineDemo={() => {
          offlineDemo.set();
          setOffline(true);
          setUser(OFFLINE_USER);
        }}
      />
    );

  return (
    <Workspace
      user={user}
      offline={offline}
      onSignOut={() => {
        auth.clear();
        offlineDemo.clear();
        setOffline(false);
        setUser(null);
      }}
    />
  );
}

function Workspace({
  user,
  offline,
  onSignOut,
}: {
  user: User;
  offline: boolean;
  onSignOut: () => void;
}) {
  const [worklist, setWorklist] = useState<WorklistItem[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [study, setStudy] = useState<Study | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [patientRef, setPatientRef] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (offline) {
      setStudies(DEMO_STUDIES);
      setWorklist(toWorklist(DEMO_STUDIES));
      setStudy((cur) => cur ?? DEMO_STUDIES[0]);
      return;
    }
    try {
      const [w, s] = await Promise.all([api.worklist(), api.studies()]);
      setWorklist(w);
      setStudies(s);
    } catch {
      /* worklist failure must not blank the screen */
    }
  }, [offline]);

  useEffect(() => {
    refresh();
    if (offline) {
      // The fallback answers "the backend is down right now". Once it is back,
      // leave it — otherwise a reviewer keeps seeing fixtures long after the
      // API recovered, with no way to tell that it had.
      api
        .ready()
        .then(() => {
          offlineDemo.clear();
          window.location.reload();
        })
        .catch(() => {});
      return;
    }
    api.ready().then(setReady).catch(() => setReady(null));
    // Wake a sleeping Space now, while the user is still choosing a file,
    // rather than after they click Analyse.
    api.wake();
  }, [refresh, offline]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const result = await api.analyze(file, patientRef.trim());
      setStudy(result);
      setTab("Overview");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function open(id: string) {
    if (offline) {
      setStudy(DEMO_STUDIES.find((s) => s.id === id) ?? null);
      setTab("Overview");
      return;
    }
    try {
      setStudy(await api.study(id));
      setTab("Overview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open study.");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--film-shoulder)" }}
      >
        <Link href="/" className="tabular text-sm font-semibold tracking-[0.12em]">
          SENTINEL<span style={{ color: "var(--instrument)" }}>·</span>CXR
        </Link>

        {offline && (
          <span
            className="tabular rounded-full border px-2 py-0.5 text-[10px] tracking-widest"
            style={{ borderColor: "var(--urgent)", color: "var(--urgent)" }}
            title="The API was unreachable, so this console is showing outputs captured earlier from the real pipeline. Uploading is disabled."
          >
            OFFLINE DEMO
          </span>
        )}

        {ready && !offline && (
          <span
            className="tabular rounded-full border px-2 py-0.5 text-[10px] tracking-widest"
            style={{
              borderColor:
                ready.mode === "full" ? "var(--instrument)" : "var(--urgent)",
              color: ready.mode === "full" ? "var(--instrument)" : "var(--urgent)",
            }}
            title={
              ready.mode === "full"
                ? "Full inference path: ensemble, MC-dropout, Grad-CAM."
                : "Inference core is cold. The ONNX fast path is serving; Grad-CAM and uncertainty are unavailable."
            }
          >
            {ready.mode === "full" ? "FULL" : "REDUCED"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-[var(--film-mid)] sm:inline">
            {user.full_name || user.email}
          </span>
          <ThemeToggle />
          <button
            onClick={onSignOut}
            className="rounded-sm border px-2.5 py-1 text-[11px] text-[var(--film-mid)]"
            style={{ borderColor: "var(--film-shoulder)" }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="border-b px-4 py-2 text-xs"
          style={{ borderColor: "var(--stat)", color: "var(--stat)" }}
        >
          {error}
        </p>
      )}

      <div className="grid flex-1 gap-px lg:grid-cols-[260px_minmax(0,1fr)_360px]"
           style={{ background: "var(--film-shoulder)" }}>
        {/* ── Worklist ─────────────────────────────────────────────────── */}
        <aside className="flex flex-col" style={{ background: "var(--film-base)" }}>
          <div className="border-b p-3" style={{ borderColor: "var(--film-shoulder)" }}>
            <label htmlFor="pref" className="block text-[11px] text-[var(--film-mid)]">
              Patient reference
            </label>
            <input
              id="pref"
              value={patientRef}
              onChange={(e) => setPatientRef(e.target.value)}
              placeholder="PT-001"
              className="tabular mt-1 w-full rounded-sm border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--film-shoulder)",
                background: "var(--film-panel)",
                color: "var(--film-highlight)",
              }}
            />
            <p className="mt-1 text-[10px] text-[var(--film-mid)]">
              Groups studies into a timeline. Use a pseudonym, never a real
              identifier.
            </p>

            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy || offline}
              className="mt-2.5 w-full rounded-sm px-3 py-2 text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--instrument)", color: "#fff" }}
              title={
                offline
                  ? "Uploading needs the inference API, which is not reachable right now."
                  : undefined
              }
            >
              {busy ? "Analysing…" : offline ? "Upload unavailable offline" : "Upload radiograph"}
            </button>

            {offline && (
              <p
                className="mt-2 rounded-sm border px-2 py-1.5 text-[10px] leading-relaxed"
                style={{ borderColor: "var(--urgent)", color: "var(--film-mid)" }}
              >
                The API is unreachable, so these five studies are outputs
                captured earlier from the real pipeline — the thresholds,
                abstention and Grad-CAM shown were all genuinely computed.
                Analysing a new image needs the live backend.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <p className="tabular px-3 pt-3 pb-1.5 text-[10px] tracking-[0.2em] text-[var(--film-mid)]">
              WORKLIST · {worklist.length}
            </p>
            {worklist.length === 0 ? (
              <p className="px-3 py-4 text-xs text-[var(--film-mid)]">
                No studies yet. Upload a radiograph to begin.
              </p>
            ) : (
              worklist.map((w) => (
                <button
                  key={w.id}
                  onClick={() => open(w.id)}
                  className={cn(
                    "block w-full border-b px-3 py-2.5 text-left transition-colors",
                    study?.id === w.id && "bg-[var(--film-panel)]",
                  )}
                  style={{ borderColor: "var(--film-shoulder)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-1 rounded-full"
                      style={{ background: PRIORITY_COLOR[w.triage_priority] }}
                    />
                    <span
                      className="tabular text-[10px] font-semibold tracking-widest"
                      style={{ color: PRIORITY_COLOR[w.triage_priority] }}
                    >
                      {w.triage_priority}
                    </span>
                    <span className="tabular ml-auto text-[10px] text-[var(--film-mid)]">
                      {formatWait(w.waited_minutes)}
                    </span>
                  </div>
                  <p className="tabular mt-1 truncate text-xs">{w.patient_ref}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--film-mid)]">
                    {w.abstained ? "Abstained" : w.is_ood ? "Rejected" : w.top_finding}
                    {!w.abstained && !w.is_ood && ` · ${w.top_probability.toFixed(2)}`}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── Viewer ───────────────────────────────────────────────────── */}
        <section className="p-4" style={{ background: "var(--film-base)" }}>
          {study ? (
            <Viewer study={study} />
          ) : (
            <div className="grid h-full min-h-[50vh] place-items-center">
              <div className="max-w-xs text-center">
                <p className="text-sm">No study selected</p>
                <p className="mt-2 text-xs text-[var(--film-mid)]">
                  Upload a frontal chest radiograph, or choose one from the
                  worklist.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Findings ─────────────────────────────────────────────────── */}
        <aside className="flex flex-col" style={{ background: "var(--film-base)" }}>
          {study ? (
            <>
              <div
                className="flex flex-wrap gap-0.5 border-b p-1.5"
                role="tablist"
                style={{ borderColor: "var(--film-shoulder)" }}
              >
                {TABS.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className="rounded-sm px-2 py-1 text-[11px] transition-colors"
                    style={{
                      background: tab === t ? "var(--instrument)" : "transparent",
                      color: tab === t ? "#fff" : "var(--film-mid)",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <Panel
                  tab={tab}
                  study={study}
                  siblings={studies.filter(
                    (s) => s.patient_ref && s.patient_ref === study.patient_ref,
                  )}
                />
              </div>
            </>
          ) : (
            <p className="p-4 text-xs text-[var(--film-mid)]">
              Findings, explainability, progression, uncertainty and the drafted
              report appear here once a study is open.
            </p>
          )}
        </aside>
      </div>

      <footer
        className="border-t px-4 py-2"
        style={{ borderColor: "var(--film-shoulder)" }}
      >
        <p className="text-[10px] text-[var(--film-mid)]">
          Research prototype for MAIB AI 114. Not a medical device. Every output
          requires radiologist review.
        </p>
      </footer>
    </div>
  );
}
