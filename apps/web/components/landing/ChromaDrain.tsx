"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

const STAGES = [
  { p: 0.97, label: "Clear effusion", note: "Well above threshold. Reported." },
  { p: 0.74, label: "Probable effusion", note: "Above threshold. Reported with margin." },
  { p: 0.52, label: "Equivocal", note: "Near threshold. Flagged as borderline." },
  { p: 0.0, label: "Abstained", note: "Below coverage. Routed to a radiologist." },
];

/**
 * The thesis, animated once.
 *
 * A single chip's chroma drains as the case gets harder, ending achromatic and
 * hatched. This is the only scroll-pinned moment on the site — stated once,
 * then dropped, rather than repeated as decoration.
 */
export function ChromaDrain() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const chroma = useTransform(scrollYProgress, [0.08, 0.85], [1, 0]);
  const probability = useTransform(scrollYProgress, [0.08, 0.85], [0.97, 0.0]);
  const hatchOpacity = useTransform(scrollYProgress, [0.72, 0.9], [0, 1]);
  const background = useTransform(
    chroma,
    (c) =>
      `color-mix(in oklab, var(--instrument) ${Math.round(Math.max(0, c) * 100)}%, var(--film-mid))`,
  );
  const width = useTransform(probability, (p) => `${Math.max(0, p) * 100}%`);
  // Declared here, above the reduced-motion early return: hooks must run in the
  // same order on every render, so none of these may live inside the JSX below.
  const readout = useTransform(probability, (p) => Math.max(0, p).toFixed(3));
  const closingOpacity = useTransform(scrollYProgress, [0.74, 0.9], [0, 1]);

  // Reduced motion gets the endpoint as a static composition rather than a
  // scroll-driven one — the argument still lands without the movement.
  if (reduce) {
    return (
      <section className="mx-auto max-w-3xl px-6 py-24">
        <SectionCopy />
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {STAGES.map((s) => (
            <div
              key={s.label}
              className="rounded-sm border p-4"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={`h-3 w-3 rounded-[2px] ${s.p === 0 ? "hatched" : ""}`}
                  style={{
                    background:
                      s.p === 0
                        ? "transparent"
                        : `color-mix(in oklab, var(--instrument) ${Math.round(s.p * 100)}%, var(--film-mid))`,
                  }}
                />
                <span className="text-sm font-medium">{s.label}</span>
                <span className="tabular ml-auto text-xs text-[var(--film-mid)]">
                  {s.p.toFixed(2)}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--film-mid)]">{s.note}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 grid h-screen place-items-center px-6">
        <div className="w-full max-w-2xl">
          <SectionCopy />

          <div
            className="mt-12 rounded-sm border p-6"
            style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
          >
            <div className="flex items-center gap-3">
              <div className="relative h-4 w-4 shrink-0 rounded-[2px]">
                <motion.span
                  className="absolute inset-0 rounded-[2px]"
                  style={{ background }}
                />
                <motion.span
                  className="hatched absolute inset-0 rounded-[2px]"
                  style={{ opacity: hatchOpacity }}
                />
              </div>
              <span className="text-lg font-medium">Effusion</span>
              <motion.span className="tabular ml-auto text-lg">{readout}</motion.span>
            </div>

            <div
              className="mt-5 h-1.5 overflow-hidden rounded-full"
              style={{ background: "var(--film-shoulder)" }}
            >
              <motion.div className="h-full rounded-full" style={{ width, background }} />
            </div>

            <motion.p
              className="mt-6 text-sm text-[var(--film-mid)]"
              style={{ opacity: closingOpacity }}
            >
              No finding met its coverage threshold. The study is routed to a
              radiologist rather than answered.
            </motion.p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionCopy() {
  return (
    <>
      <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
        CONFIDENCE IS CHROMA
      </p>
      <h2
        className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
        style={{ fontSize: "var(--text-step-4)" }}
      >
        Colour drains as the model doubts.
      </h2>
      <p className="mt-4 max-w-xl text-[var(--film-mid)]">
        The interface is monochrome by design — a colour cast over a radiograph
        is clinically wrong. So colour is spent on one thing only: how sure the
        model is. At the abstention threshold it disappears entirely.
      </p>
    </>
  );
}
