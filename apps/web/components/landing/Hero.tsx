"use client";

import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useResolvedTheme } from "@/lib/useTheme";

const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

/**
 * Full-viewport hero.
 *
 * The 3D volume occupies the whole first screen and remains fixed behind the
 * page rather than sitting in a boxed panel. Type sits over it, and both fade
 * as the reader scrolls into the argument.
 *
 * Without WebGL or under prefers-reduced-motion the canvas is skipped entirely
 * and a static radiographic gradient stands in — the page never depends on 3D
 * being available, and a continuously rotating object is exactly what
 * reduced-motion exists to suppress.
 */
export function Hero() {
  const reduce = useReducedMotion();
  const theme = useResolvedTheme();
  const light = theme === "light";
  const [enable3d, setEnable3d] = useState(false);
  const progress = useRef(0);
  const ref = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll();
  const { scrollYProgress: heroProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const textOpacity = useTransform(heroProgress, [0, 0.55], [1, 0]);
  const textY = useTransform(heroProgress, [0, 1], ["0%", "18%"]);
  const veil = useTransform(heroProgress, [0, 1], [0.15, 0.72]);

  useEffect(() => {
    setEnable3d(!reduce && webglAvailable());
  }, [reduce]);

  useEffect(() => {
    progress.current = 0.12;
    return scrollYProgress.on("change", (v) => {
      progress.current = Math.min(1, 0.12 + v * 5.2);
    });
  }, [scrollYProgress]);

  return (
    <section
      ref={ref}
      className="relative min-h-[100svh] overflow-hidden"
      style={{ background: "var(--film-base)" }}
    >
      {/* The canvas is fixed so the volume persists behind the whole page. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {enable3d ? (
          <HeroCanvas progress={progress} light={light} />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: light
                ? "radial-gradient(120% 80% at 50% 40%, #FFFFFF 0%, #EDF0F2 62%)"
                : "radial-gradient(120% 80% at 50% 40%, #1B2429 0%, #0B0D0E 62%)",
            }}
          />
        )}
        {/* Veil deepens on scroll so body copy stays legible over the volume. */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "var(--film-base)", opacity: veil }}
        />
      </div>

      <motion.div
        className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-6 pt-24"
        style={{ opacity: reduce ? 1 : textOpacity, y: reduce ? 0 : textY }}
      >
        <p className="tabular text-[11px] tracking-[0.34em]"
          style={{ color: "var(--film-mid)" }}>
          MAIB AI 114 · FINAL GROUP PROJECT
        </p>

        <h1
          className="mt-6 font-[family-name:var(--font-display)] tracking-[-0.035em]"
          style={{
            fontSize: "var(--text-hero)",
            lineHeight: 0.9,
            color: "var(--film-highlight)",
          }}
        >
          <span className="block">It tells you when</span>
          <span className="block">
            it doesn&rsquo;t{" "}
            <span style={{ color: "var(--instrument)" }}>know</span>.
          </span>
        </h1>

        <p className="mt-8 max-w-xl text-[var(--text-step-1)] leading-relaxed"
          style={{ color: "var(--film-mid)" }}>
          A chest radiograph triage system with calibrated uncertainty. Fourteen
          pathologies, a distribution-free coverage guarantee, and the discipline
          to abstain rather than guess.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/console"
            className="rounded-full px-7 py-3.5 text-sm font-medium transition-transform hover:scale-[1.02] active:scale-[0.99]"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            Open the demo — no sign-up
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border px-7 py-3.5 text-sm font-medium"
            style={{
              borderColor: "var(--film-shoulder)",
              color: "var(--film-highlight)",
            }}
          >
            View the dashboard
          </Link>
        </div>

        <div
          className="mt-14 flex flex-wrap gap-x-10 gap-y-4 border-t pt-6"
          style={{ borderColor: "var(--film-shoulder)" }}
        >
          {[
            ["0.9004", "empirical coverage"],
            ["151 ms", "on 0.1 CPU"],
            ["112,120", "radiographs"],
            ["83", "tests passing"],
          ].map(([v, l]) => (
            <div key={l}>
              <p className="tabular text-lg" style={{ color: "var(--film-highlight)" }}>
                {v}
              </p>
              <p className="text-[11px]" style={{ color: "var(--film-mid)" }}>
                {l}
              </p>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        aria-hidden
        className="absolute inset-x-0 bottom-6 z-10 flex justify-center"
        style={{ opacity: reduce ? 1 : textOpacity }}
      >
        <span
          className="tabular text-[10px] tracking-[0.3em]"
          style={{ color: "var(--film-mid)" }}
        >
          SCROLL TO ASSEMBLE
        </span>
      </motion.div>
    </section>
  );
}
