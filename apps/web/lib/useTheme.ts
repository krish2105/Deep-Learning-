"use client";

import { useEffect, useState } from "react";

export type Resolved = "light" | "dark";

/**
 * The theme actually in effect, resolved from all three states.
 *
 * The toggle stores "light", "dark" or "system"; only the first two stamp
 * `data-theme` on the root, and "system" stamps nothing and defers to
 * `prefers-color-scheme`. Anything that needs the resolved value in JS — the
 * WebGL scene, which cannot read CSS variables — has to reproduce that logic
 * and watch both sources.
 */
export function useResolvedTheme(): Resolved {
  // Default to dark to match the server-rendered markup; the effect corrects
  // it before first paint matters.
  const [theme, setTheme] = useState<Resolved>("dark");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    const resolve = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") {
        setTheme(attr);
        return;
      }
      setTheme(media.matches ? "light" : "dark");
    };

    resolve();

    // The toggle mutates the root attribute rather than firing an event, so
    // observe it directly.
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", resolve);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolve);
    };
  }, []);

  return theme;
}
