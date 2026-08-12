"use client";

import { useEffect, useState } from "react";
import { SERIES } from "@/components/charts/primitives";
import { ApiError, api } from "@/lib/api";
import type { Study } from "@/lib/types";

const MUTED = "var(--film-mid)";

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-sm border border-dashed p-5 text-center"
      style={{ borderColor: "var(--film-shoulder)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[11px]" style={{ color: MUTED }}>
        {body}
      </p>
    </div>
  );
}

/* ── Natural-language query bar ─────────────────────────────────────────
   Sits above the worklist. The language layer produces only a FILTER — it
   never decides anything clinical, and it cannot surface a study the
   deterministic filter would not have returned.
   ─────────────────────────────────────────────────────────────────────── */
export function QueryBar({
  onFilter,
  disabled,
}: {
  onFilter: (ids: string[] | null, interpretation: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const EXAMPLES = ["abstained studies", "STAT cases", "worsening patients", "above 0.8"];

  async function run(text: string) {
    if (!text.trim()) {
      onFilter(null, "");
      setNote("");
      return;
    }
    setBusy(true);
    try {
      const res = await api.nlQuery(text);
      onFilter(res.study_ids, res.interpretation);
      setNote(`${res.n_matched} of ${res.n_total} · ${res.interpretation}`);
    } catch (err) {
      setNote(
        err instanceof ApiError
          ? err.message
          : "Query unavailable — the API could not be reached.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b p-3" style={{ borderColor: "var(--film-shoulder)" }}>
      <label htmlFor="nlq" className="block text-[11px]" style={{ color: MUTED }}>
        Ask about your studies
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        className="mt-1.5 flex gap-1.5"
      >
        <input
          id="nlq"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={disabled}
          placeholder="show me abstained studies"
          className="min-w-0 flex-1 rounded-sm border px-2 py-1.5 text-xs outline-none disabled:opacity-50"
          style={{
            borderColor: "var(--film-shoulder)",
            background: "var(--film-panel)",
            color: "var(--film-highlight)",
          }}
        />
        <button
          type="submit"
          disabled={busy || disabled}
          className="shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--instrument)", color: "#fff" }}
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => {
              setQ(e);
              run(e);
            }}
            disabled={disabled}
            className="rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-40"
            style={{ borderColor: "var(--film-shoulder)", color: MUTED }}
          >
            {e}
          </button>
        ))}
        {note && (
          <button
            onClick={() => {
              setQ("");
              run("");
            }}
            className="rounded-full px-2 py-0.5 text-[10px]"
            style={{ color: "var(--instrument)" }}
          >
            clear
          </button>
        )}
      </div>

      {note && (
        <p className="mt-1.5 text-[10px]" style={{ color: MUTED }}>
          {note}
        </p>
      )}
    </div>
  );
}

/* ── Similar cases ──────────────────────────────────────────────────── */
export function SimilarPanel({
  study,
  onOpen,
}: {
  study: Study;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.similar>> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    setState("loading");
    api
      .similar(study.id)
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch((e) => {
        setErr(e instanceof ApiError ? e.message : "");
        setState("error");
      });
  }, [study.id]);

  if (state === "loading")
    return <p className="text-xs" style={{ color: MUTED }}>Searching…</p>;
  if (state === "error")
    return (
      <Empty
        title="Unavailable"
        body={err || "Similar-case search needs the API."}
      />
    );
  if (!data?.matches.length)
    return (
      <Empty
        title="No similar studies"
        body="Nothing in this worklist is close enough to be worth showing. A weak match padded into the list would invite reading meaning into noise."
      />
    );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {data.matches.map((m) => (
          <button
            key={m.study_id}
            onClick={() => onOpen(m.study_id)}
            className="flex w-full items-center gap-3 rounded-sm border p-2 text-left transition-colors hover:border-[var(--instrument)]"
            style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
          >
            {m.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.thumbnail}
                alt=""
                className="viewer-surface h-11 w-11 shrink-0 rounded-[2px] object-cover"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="tabular block truncate text-xs">{m.patient_ref}</span>
              <span className="block truncate text-[11px]" style={{ color: MUTED }}>
                {m.top_finding} · {m.triage_priority}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className="tabular block text-xs"
                style={{ color: SERIES[0] }}
              >
                {m.similarity.toFixed(3)}
              </span>
              <span className="block text-[9px]" style={{ color: MUTED }}>
                cosine
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed" style={{ color: MUTED }}>
        {data.note}
      </p>
    </div>
  );
}

/* ── Patient timeline ───────────────────────────────────────────────── */
export function TimelinePanel({
  study,
  onOpen,
}: {
  study: Study;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.timeline>> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!study.patient_ref) {
      setState("ok");
      setData(null);
      return;
    }
    setState("loading");
    api
      .timeline(study.patient_ref)
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch((e) => {
        setErr(e instanceof ApiError ? e.message : "");
        setState("error");
      });
  }, [study.patient_ref]);

  if (state === "loading")
    return <p className="text-xs" style={{ color: MUTED }}>Building timeline…</p>;
  if (state === "error")
    return (
      <Empty title="Unavailable" body={err || "Timeline generation needs the API."} />
    );
  if (!data?.available)
    return (
      <Empty
        title="Not enough visits"
        body={data?.note ?? "A timeline needs at least two completed studies for this patient."}
      />
    );

  return (
    <div className="space-y-3">
      <ol className="relative space-y-2 pl-6">
        <span
          aria-hidden
          className="absolute left-[7px] top-2 bottom-2 w-px"
          style={{ background: "var(--film-shoulder)" }}
        />
        {data.trajectory?.map((t) => (
          <li key={t.study_id} className="relative">
            <span
              aria-hidden
              className="absolute -left-6 top-2 h-3.5 w-3.5 rounded-full border-2"
              style={{
                borderColor: t.abstained ? "var(--urgent)" : SERIES[0],
                background: "var(--film-base)",
              }}
            />
            <button
              onClick={() => onOpen(t.study_id)}
              className="w-full rounded-sm border p-2 text-left transition-colors hover:border-[var(--instrument)]"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <div className="flex items-center gap-2">
                <span className="tabular text-[10px]" style={{ color: MUTED }}>
                  VISIT {t.visit}
                </span>
                <span className="tabular ml-auto text-[10px]" style={{ color: MUTED }}>
                  {t.triage}
                </span>
              </div>
              <p className="mt-0.5 text-xs">
                {t.abstained ? "Abstained" : t.top_finding}{" "}
                <span className="tabular" style={{ color: MUTED }}>
                  {t.top_probability.toFixed(3)}
                </span>
              </p>
            </button>
          </li>
        ))}
      </ol>

      {data.net_change && Object.keys(data.net_change).length > 0 && (
        <div
          className="rounded-sm border px-3 py-2"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <p className="text-[10px]" style={{ color: MUTED }}>NET CHANGE</p>
          {Object.entries(data.net_change).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-0.5">
              <span className="text-xs">{k}</span>
              <span
                className="tabular text-xs"
                style={{ color: v > 0 ? "var(--stat)" : SERIES[0] }}
              >
                {v > 0 ? "+" : ""}
                {v.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.narrative && (
        <details
          className="rounded-sm border p-3"
          style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
        >
          <summary className="cursor-pointer text-[11px]" style={{ color: MUTED }}>
            Generated summary ({data.narrative_source})
          </summary>
          <pre className="mt-2 text-[10px] leading-relaxed whitespace-pre-wrap" style={{ color: MUTED }}>
            {data.narrative}
          </pre>
        </details>
      )}

      <p className="text-[10px]" style={{ color: MUTED }}>{data.span_note}</p>
    </div>
  );
}

/* ── Disagreement ───────────────────────────────────────────────────── */
export function DisagreementPanel({ study }: { study: Study }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.disagreement>> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    setState("loading");
    api
      .disagreement(study.id)
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch((e) => {
        setErr(e instanceof ApiError ? e.message : "");
        setState("error");
      });
  }, [study.id]);

  if (state === "loading")
    return <p className="text-xs" style={{ color: MUTED }}>Comparing estimates…</p>;
  if (state === "error")
    return (
      <Empty title="Unavailable" body={err || "Disagreement analysis needs the API."} />
    );
  if (!data?.n_conflicts)
    return (
      <Empty
        title="No disagreement"
        body="Independent estimates of this study agree within tolerance. That is a good sign, not a missing feature."
      />
    );

  const max = Math.max(...data.conflicts.map((c) => c.gap), data.threshold);

  return (
    <div className="space-y-3">
      <div
        className="rounded-sm border px-3 py-2"
        style={{ borderColor: "var(--urgent)", background: "var(--film-panel)" }}
      >
        <p className="text-xs">
          <span className="tabular" style={{ color: "var(--urgent)" }}>
            {data.n_conflicts}
          </span>{" "}
          finding{data.n_conflicts === 1 ? "" : "s"} where estimates diverge
        </p>
      </div>

      <div className="space-y-2">
        {data.conflicts.map((c) => (
          <div
            key={`${c.pathology}-${c.kind}`}
            className="rounded-sm border p-2.5"
            style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs">{c.pathology}</span>
              <span className="tabular text-[10px]" style={{ color: MUTED }}>
                {c.kind}
              </span>
              <span className="tabular text-xs" style={{ color: "var(--urgent)" }}>
                {c.gap.toFixed(3)}
              </span>
            </div>
            <div
              className="mt-2 h-1 overflow-hidden rounded-full"
              style={{ background: "var(--film-shoulder)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (c.gap / max) * 100)}%`,
                  background: "var(--urgent)",
                }}
              />
            </div>
            {c.std !== undefined && (
              <p className="tabular mt-1 text-[10px]" style={{ color: MUTED }}>
                sd {c.std.toFixed(4)} across samples
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: MUTED }}>
        {data.note}
      </p>
    </div>
  );
}
