"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { HotLight } from "./HotLight";

/**
 * Chooses the hero visual, with progressive enhancement as a hard requirement.
 *
 * The 3D cloud is lazy-loaded and client-only — bundling three.js into the
 * initial payload would cost every visitor ~150 KB for something that must be
 * optional anyway.
 *
 * It is skipped entirely when WebGL is unavailable, or when the user prefers
 * reduced motion (a continuously rotating object is exactly what that setting
 * exists to suppress). In both cases the 2D hot-light hero renders instead —
 * which is not a degraded placeholder but the original signature element, and
 * still demonstrates the product.
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
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

export function HeroVisual() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<"pending" | "3d" | "2d">("pending");

  useEffect(() => {
    setMode(!reduce && webglAvailable() ? "3d" : "2d");
  }, [reduce]);

  // Render the 2D hero during the first paint so there is never an empty box,
  // and so the page is meaningful before any JavaScript decides otherwise.
  if (mode !== "3d") return <HotLight />;
  return <Thorax3D />;
}
