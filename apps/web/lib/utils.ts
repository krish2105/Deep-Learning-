import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

/**
 * Confidence as chroma — the visual thesis of the interface.
 *
 * The API returns `chroma` in [0,1] (see uncertainty.py::confidence_to_chroma).
 * This turns it into a colour: full saturation when the model is confident,
 * draining to neutral grey as it doubts, fully achromatic at the abstention
 * threshold. `color-mix` in oklab keeps the desaturation perceptually even
 * rather than muddying through the sRGB midpoint.
 */
export function chromaColor(chroma: number, muted = "var(--film-mid)") {
  const pct = Math.round(Math.max(0, Math.min(1, chroma)) * 100);
  return `color-mix(in oklab, var(--instrument) ${pct}%, ${muted})`;
}

export const PRIORITY_COLOR: Record<string, string> = {
  STAT: "var(--stat)",
  URGENT: "var(--urgent)",
  ROUTINE: "var(--film-mid)",
};

export function formatRelative(iso: string): string {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${String(m).padStart(2, "0")}:${"00"}`;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Nats -> a plain word. Uncertainty figures mean nothing to most readers. */
export function uncertaintyLabel(nats: number): string {
  if (nats < 0.1) return "low";
  if (nats < 0.35) return "moderate";
  return "high";
}
