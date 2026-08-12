"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const KEY = "sentinel-theme";

/**
 * Applies the stored theme before first paint.
 *
 * Without this the page renders in the default theme and then snaps to the
 * chosen one — a flash that looks broken and, in a dark reading room, is
 * genuinely unpleasant.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";if(t==="system"){document.documentElement.removeAttribute("data-theme")}else{document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme((localStorage.getItem(KEY) as Theme) ?? "system");
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem(KEY, next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }

  const options: { value: Theme; label: string; icon: string }[] = [
    { value: "light", label: "Light", icon: "☀" },
    { value: "dark", label: "Dark", icon: "☾" },
    { value: "system", label: "System", icon: "◐" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border p-0.5",
        className,
      )}
      style={{ borderColor: "var(--film-shoulder)", background: "var(--film-fog)" }}
    >
      {options.map((o) => {
        const active = mounted && theme === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => apply(o.value)}
            className="grid h-7 w-7 place-items-center rounded-full text-xs transition-colors"
            style={{
              background: active ? "var(--instrument)" : "transparent",
              color: active ? "#fff" : "var(--film-mid)",
            }}
          >
            <span aria-hidden>{o.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
