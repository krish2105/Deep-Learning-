"use client";

import { useReducedMotion, useScroll } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { HotLight } from "./HotLight";

/**
 * Chooses the hero visual, with progressive enhancement as a hard requirement.
 *
 * The 3D cloud is lazy-loaded and client-only — bundling three.js into the
 * initial payload would cost every visitor ~150 KB for something that must be
 * optional anyway.
 *
 * It is skipped entirely without WebGL, or when the user prefers reduced motion
 * (a continuously rotating, scroll-driven object is precisely what that setting
 * exists to suppress). Both fall back to the 2D hot-light hero, which is not a
 * degraded placeholder but the original signature element.
 */

const Thorax3D = dynamic(() => import("./Thorax3D"), {
  ssr: false,
  loading: () => (
    <div
      className="viewer-surface aspect-4/5 w-full max-w-md animate-pulse rounded-sm"
      style={{ boxShadow: "var(--shadow-panel)" }}
    />
  ),
});

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

export function HeroVisual() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<"pending" | "3d" | "2d">("pending");

  // Assembly is driven by page scroll rather than a timer, so the reader
  // controls the reveal. A ref (not state) because it updates every frame and
  // re-rendering React at 60fps to move particles would be absurd.
  const progress = useRef(0);
  const { scrollYProgress } = useScroll();

  useEffect(() => {
    setMode(!reduce && webglAvailable() ? "3d" : "2d");
  }, [reduce]);

  useEffect(() => {
    // Fully assembled by ~18% of the page, so it is resolved before the reader
    // reaches the first argument and does not lag behind the copy.
    progress.current = 0.15;
    return scrollYProgress.on("change", (v) => {
      progress.current = Math.min(1, 0.15 + v * 4.7);
    });
  }, [scrollYProgress]);

  if (mode !== "3d") return <HotLight />;
  return <Thorax3D progress={progress} />;
}
