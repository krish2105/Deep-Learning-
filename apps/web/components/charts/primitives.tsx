"use client";

/**
 * Chart primitives.
 *
 * Hand-built SVG rather than a charting library: the bundle stays small, and
 * every mark spec below (thin marks, rounded data-ends, 2px surface gaps,
 * recessive axes) is enforced rather than fought.
 *
 * The categorical palette was validated, not chosen by eye. Running the
 * six-check validator against both the dark panel (#16191B) and white:
 *
 *   Lightness band      PASS   all 5 inside band
 *   Chroma floor        PASS   all 5 >= 0.1  (no slot reads as grey)
 *   CVD separation      PASS   worst adjacent dE 17.9 (protan)
 *   Normal-vision floor PASS   worst adjacent dE 22.3
 *   Contrast vs surface PASS   all 5 >= 3:1
 *
 * The order is part of the result — adjacent pairs are what the separation
 * checks measure, so hues are assigned in this fixed order and never cycled.
 */

import { useId, useState } from "react";

export const SERIES = [
  "#2E9CB8", // instrument cyan — the brand hue, slot 1
  "#C4802F", // amber
  "#7C6BD6", // violet
  "#C8433F", // red
  "#4E7FD4", // blue
] as const;

export const INK = {
  primary: "var(--film-highlight)",
  secondary: "var(--film-mid)",
  grid: "var(--film-shoulder)",
  surface: "var(--film-panel)",
} as const;

/** Text never wears a series colour — identity is carried by the mark beside it. */
export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string; texture?: boolean }[];
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <figure
      className="rounded-sm border p-4"
      style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
    >
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium" style={{ color: INK.primary }}>
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px]" style={{ color: INK.secondary }}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </figcaption>

      {children}

      {/* A legend is always present for two or more series, so identity is
          never carried by colour alone. */}
      {legend && legend.length >= 2 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-[2px] ${l.texture ? "hatched" : ""}`}
                style={{ background: l.texture ? "transparent" : l.color }}
              />
              <span className="text-[11px]" style={{ color: INK.secondary }}>
                {l.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Shared hover tooltip. Every chart ships one — an SVG chart is interactive. */
export function useTooltip<T>() {
  const [tip, setTip] = useState<{ x: number; y: number; datum: T } | null>(null);
  return { tip, setTip };
}

export function Tooltip({
  x,
  y,
  children,
  width = 168,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-sm border px-2.5 py-1.5 text-[11px] shadow-lg"
      style={{
        left: x,
        top: y,
        width,
        transform: "translate(-50%, -115%)",
        borderColor: "var(--film-shoulder)",
        background: "var(--film-base)",
        color: INK.primary,
      }}
    >
      {children}
    </div>
  );
}

/** Recessive gridlines. They orient the eye; they are never the subject. */
export function Grid({
  ticks,
  width,
  height,
  padLeft,
  format = (v: number) => v.toFixed(1),
}: {
  ticks: number[];
  width: number;
  height: number;
  padLeft: number;
  format?: (v: number) => string;
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => {
        const x = padLeft + t * (width - padLeft);
        return (
          <g key={t}>
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke={INK.grid}
              strokeWidth={1}
              opacity={0.55}
            />
            <text
              x={x}
              y={height + 12}
              fontSize={9}
              textAnchor="middle"
              fill={INK.secondary}
              className="tabular"
            >
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Empty state — an empty chart frame reads as broken, so say what is missing. */
export function ChartEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-sm border border-dashed p-6 text-center"
      style={{ borderColor: "var(--film-shoulder)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[11px]" style={{ color: INK.secondary }}>
        {body}
      </p>
    </div>
  );
}

/** 45° hatch, for abstention and for the CVD / print / forced-colours case. */
export function HatchDef({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width={5} height={5} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width={5} height={5} fill="transparent" />
        <line x1={0} y1={0} x2={0} y2={5} stroke={color} strokeWidth={2.2} />
      </pattern>
    </defs>
  );
}

export function useChartId() {
  return useId().replace(/:/g, "");
}
