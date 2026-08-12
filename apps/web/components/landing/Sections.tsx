"use client";

import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SERIES } from "@/components/charts/primitives";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ══════════════════════════════════════════════════════════════════════
   Metrics wall — measured numbers, counted up on entry
   ══════════════════════════════════════════════════════════════════════ */
const METRICS = [
  { value: 0.9004, label: "Empirical coverage", sub: "against a 0.90 nominal target", decimals: 4 },
  { value: 143, label: "Milliseconds", sub: "ONNX fast path, 0.1 CPU", decimals: 0 },
  { value: 112120, label: "Radiographs", sub: "30,805 patients, patient-disjoint splits", decimals: 0 },
  { value: 83, label: "Tests passing", sub: "coverage, grounding, triage, fairness", decimals: 0 },
];

function Counter({ to, decimals }: { to: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1400, bounce: 0 });
  const [shown, setShown] = useState(reduce ? to : 0);

  useEffect(() => {
    if (reduce) return;
    if (inView) mv.set(to);
    return spring.on("change", (v) => setShown(v));
  }, [inView, mv, spring, to, reduce]);

  const fmt = (v: number) =>
    decimals > 0
      ? v.toFixed(decimals)
      : Math.round(v).toLocaleString("en-US");

  return (
    <span ref={ref} className="tabular">
      {fmt(reduce ? to : shown)}
    </span>
  );
}

export function MetricsWall() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
        MEASURED, NOT CLAIMED
      </p>
      <div className="mt-8 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((m, i) => (
          <motion.div
            key={m.label}
            className="p-6"
            style={{ background: "var(--film-panel)" }}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12% 0px" }}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.06 }}
          >
            <p
              className="font-[family-name:var(--font-display)] leading-none"
              style={{ fontSize: "var(--text-step-4)", color: "var(--instrument)" }}
            >
              <Counter to={m.value} decimals={m.decimals} />
            </p>
            <p className="mt-3 text-sm font-medium">{m.label}</p>
            <p className="mt-1 text-xs text-[var(--film-mid)]">{m.sub}</p>
          </motion.div>
        ))}
      </div>
      <p className="mt-4 text-xs text-[var(--film-mid)]">
        Every figure above was produced by running the system, not estimated.
        Classification metrics on the full dataset are marked outstanding in the
        report rather than filled in.
      </p>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Pipeline — draws itself as you scroll
   ══════════════════════════════════════════════════════════════════════ */
const STEPS = [
  ["Upload", "Presigned URL, stored"],
  ["VAE gate", "Not a radiograph? Refuse before classifying"],
  ["Classifier", "DenseNet-121, 14 sigmoid outputs"],
  ["Uncertainty", "Epistemic split from aleatoric"],
  ["Conformal", "Prediction set at 90% coverage"],
  ["Abstain?", "Empty or oversized → route to a human"],
  ["Grad-CAM", "Per-finding activation map"],
  ["Progression", "LSTM over prior visits"],
  ["Triage", "DQN priority in the worklist"],
  ["Report", "LLM grounded strictly in the above"],
  ["Persist", "Audit entry, streamed to client"],
];

export function Pipeline() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.35"],
  });

  return (
    <section ref={ref} className="mx-auto max-w-4xl px-6 py-24">
      <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
        ELEVEN STEPS, ONE DECISION EACH
      </p>
      <h2
        className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
        style={{ fontSize: "var(--text-step-4)" }}
      >
        Every stage can stop the pipeline.
      </h2>
      <p className="mt-4 max-w-xl text-[var(--film-mid)]">
        Two of these eleven steps exist purely to refuse. That is the design.
      </p>

      <div className="relative mt-12 pl-8">
        {/* the spine, drawn by scroll */}
        <div
          className="absolute left-[11px] top-2 bottom-2 w-px"
          style={{ background: "var(--film-shoulder)" }}
        />
        <motion.div
          className="absolute left-[11px] top-2 w-px origin-top"
          style={{
            background: "var(--instrument)",
            bottom: 8,
            scaleY: reduce ? 1 : scrollYProgress,
          }}
        />

        <ol className="space-y-5">
          {STEPS.map(([name, detail], i) => {
            const isRefusal = name === "VAE gate" || name === "Abstain?";
            return (
              <motion.li
                key={name}
                className="relative"
                initial={reduce ? undefined : { opacity: 0, x: -8 }}
                whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-10% 0px" }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <span
                  aria-hidden
                  className="absolute -left-8 top-1.5 grid h-[22px] w-[22px] place-items-center rounded-full text-[10px]"
                  style={{
                    background: isRefusal ? "var(--urgent)" : "var(--film-panel)",
                    border: `1px solid ${isRefusal ? "var(--urgent)" : "var(--film-shoulder)"}`,
                    color: isRefusal ? "#0B0D0E" : "var(--film-mid)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-sm font-medium">
                  {name}
                  {isRefusal && (
                    <span
                      className="tabular ml-2 text-[10px] tracking-widest"
                      style={{ color: "var(--urgent)" }}
                    >
                      CAN REFUSE
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[var(--film-mid)]">{detail}</p>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Marquee — the fourteen pathologies, weighted by clinical urgency
   ══════════════════════════════════════════════════════════════════════ */
const PATHOLOGIES: [string, number][] = [
  ["Pneumothorax", 1.0], ["Edema", 0.85], ["Consolidation", 0.7],
  ["Pneumonia", 0.7], ["Mass", 0.65], ["Effusion", 0.55],
  ["Cardiomegaly", 0.45], ["Infiltration", 0.45], ["Nodule", 0.4],
  ["Atelectasis", 0.35], ["Pleural Thickening", 0.25], ["Fibrosis", 0.2],
  ["Emphysema", 0.2], ["Hernia", 0.15],
];

export function Marquee() {
  const reduce = useReducedMotion();
  const row = [...PATHOLOGIES, ...PATHOLOGIES];

  return (
    <section
      className="overflow-hidden border-y py-5"
      style={{ borderColor: "var(--film-shoulder)" }}
      aria-label="The fourteen pathologies, sized by clinical urgency"
    >
      <motion.div
        className="flex w-max gap-8"
        animate={reduce ? undefined : { x: ["0%", "-50%"] }}
        transition={
          reduce
            ? undefined
            : { duration: 42, repeat: Infinity, ease: "linear" }
        }
      >
        {row.map(([name, urgency], i) => (
          <span
            key={`${name}-${i}`}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap"
            style={{
              // Size and colour both encode urgency, so it survives greyscale.
              fontSize: `${0.85 + urgency * 0.75}rem`,
              color:
                urgency > 0.6
                  ? "var(--film-highlight)"
                  : "var(--film-mid)",
              opacity: 0.45 + urgency * 0.55,
            }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: urgency >= 0.85 ? "var(--stat)" : "var(--instrument)",
              }}
            />
            {name}
          </span>
        ))}
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Live demo — the product working, inline
   ══════════════════════════════════════════════════════════════════════ */
const SCENARIO = [
  { label: "Effusion", p: 0.94, in: true },
  { label: "Cardiomegaly", p: 0.71, in: true },
  { label: "Nodule", p: 0.42, in: false },
  { label: "Pneumothorax", p: 0.08, in: false },
];

export function LiveDemo() {
  const [stage, setStage] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setStage(4);
      return;
    }
    const timers = [600, 1500, 2400, 3200].map((ms, i) =>
      setTimeout(() => setStage(i + 1), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce]);

  return (
    <section ref={ref} className="mx-auto max-w-5xl px-6 py-24">
      <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
        WHAT A READ LOOKS LIKE
      </p>
      <h2
        className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
        style={{ fontSize: "var(--text-step-4)" }}
      >
        Scores become a set, and the set can be empty.
      </h2>

      <div
        className="mt-10 grid gap-px overflow-hidden rounded-sm border lg:grid-cols-[1fr_1fr]"
        style={{ borderColor: "var(--film-shoulder)" }}
      >
        <div className="p-6" style={{ background: "var(--film-panel)" }}>
          <p className="tabular text-[10px] tracking-widest text-[var(--film-mid)]">
            RAW SIGMOID OUTPUT
          </p>
          <div className="mt-4 space-y-2.5">
            {SCENARIO.map((f, i) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs">{f.label}</span>
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full"
                  style={{ background: "var(--film-shoulder)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--film-mid)" }}
                    initial={{ width: 0 }}
                    animate={{ width: stage >= 1 ? `${f.p * 100}%` : 0 }}
                    transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
                  />
                </div>
                <span className="tabular w-12 text-right text-xs text-[var(--film-mid)]">
                  {f.p.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-[var(--film-mid)]">
            A sigmoid output is not a probability of being correct. Thresholding
            it at 0.5 guarantees nothing.
          </p>
        </div>

        <div className="p-6" style={{ background: "var(--film-panel)" }}>
          <p className="tabular text-[10px] tracking-widest" style={{ color: "var(--instrument)" }}>
            AFTER CONFORMAL CALIBRATION
          </p>
          <div className="mt-4 space-y-2">
            {SCENARIO.map((f, i) => (
              <motion.div
                key={f.label}
                className="flex items-center gap-2.5 rounded-sm border px-3 py-2"
                style={{
                  borderColor: f.in && stage >= 2 ? "var(--instrument)" : "var(--film-shoulder)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: stage >= 2 ? 1 : 0 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 rounded-[2px] ${!f.in ? "hatched" : ""}`}
                  style={{
                    background: f.in
                      ? `color-mix(in oklab, var(--instrument) ${Math.round(f.p * 100)}%, var(--film-mid))`
                      : "transparent",
                  }}
                />
                <span className="flex-1 text-xs">{f.label}</span>
                <span className="tabular text-[10px] text-[var(--film-mid)]">
                  {f.in ? "IN SET" : "BELOW τ"}
                </span>
              </motion.div>
            ))}
          </div>

          <motion.div
            className="mt-5 rounded-sm border p-3"
            style={{ borderColor: "var(--instrument)" }}
            initial={{ opacity: 0, y: 6 }}
            animate={stage >= 3 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <p className="text-xs">
              Prediction set:{" "}
              <span style={{ color: "var(--instrument)" }}>Effusion, Cardiomegaly</span>
            </p>
            <p className="tabular mt-1 text-[10px] text-[var(--film-mid)]">
              90% marginal coverage · α = 0.10 · not simultaneous across labels
            </p>
          </motion.div>

          <motion.p
            className="mt-3 text-xs text-[var(--film-mid)]"
            initial={{ opacity: 0 }}
            animate={stage >= 4 ? { opacity: 1 } : {}}
            transition={{ duration: 0.5 }}
          >
            Had the set come back empty with several near-threshold scores, the
            system would have abstained and sent this to a radiologist instead.
          </motion.p>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Architecture — the constraint that shaped the system
   ══════════════════════════════════════════════════════════════════════ */
export function Architecture() {
  const TIERS = [
    { name: "Vercel", spec: "Next.js 15", note: "landing, console, dashboard", color: SERIES[0] },
    { name: "Render", spec: "512 MB · 0.1 CPU", note: "orchestration + ONNX int8 inference", color: SERIES[1] },
    { name: "HF Spaces", spec: "16 GB", note: "Grad-CAM, MC sampling — optional", color: SERIES[2] },
    { name: "Supabase", spec: "Postgres", note: "accounts, studies, audit log", color: SERIES[4] },
  ];

  return (
    <section className="mx-auto max-w-5xl px-6 py-24">
      <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
        ARCHITECTURE
      </p>
      <h2
        className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
        style={{ fontSize: "var(--text-step-4)" }}
      >
        512 MB shaped everything.
      </h2>
      <p className="mt-4 max-w-2xl text-[var(--film-mid)]">
        PyTorch does not fit in Render&rsquo;s free tier. Rather than depend on a
        second free service being awake, the classifier was quantised to a 7.9 MB
        ONNX model that runs on the orchestrator itself — so the system diagnoses
        even when everything optional is down.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t, i) => (
          <motion.div
            key={t.name}
            className="rounded-sm border p-5"
            style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 0.55, ease: EASE, delay: i * 0.07 }}
          >
            <span
              aria-hidden
              className="block h-1 w-8 rounded-full"
              style={{ background: t.color }}
            />
            <p className="mt-3 text-sm font-medium">{t.name}</p>
            <p className="tabular mt-1 text-[11px]" style={{ color: t.color }}>
              {t.spec}
            </p>
            <p className="mt-2 text-xs text-[var(--film-mid)]">{t.note}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
