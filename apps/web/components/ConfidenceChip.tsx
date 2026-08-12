"use client";

import { chromaColor, cn } from "@/lib/utils";
import type { PathologyFinding } from "@/lib/types";

/**
 * A finding rendered as chroma.
 *
 * Saturation encodes confidence: full colour when the model is certain,
 * draining to neutral as it doubts, fully achromatic plus a diagonal hatch at
 * the abstention threshold. Colour is never the only signal — the hatch, the
 * label and the numeric probability all carry it too, so the chip remains
 * readable for colour-blind users and in greyscale print.
 */
export function ConfidenceChip({
  finding,
  onClick,
  selected,
  showBar = true,
}: {
  finding: PathologyFinding;
  onClick?: () => void;
  selected?: boolean;
  showBar?: boolean;
}) {
  const color = chromaColor(finding.chroma);
  const isAbstainLike = !finding.included && finding.chroma === 0;
  const Element = onClick ? "button" : "div";

  return (
    <Element
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "group w-full rounded-sm border px-3 py-2 text-left transition-all",
        onClick && "hover:border-[var(--instrument)] cursor-pointer",
      )}
      style={{
        borderColor: selected ? "var(--instrument)" : "var(--film-shoulder)",
        background: selected
          ? "color-mix(in oklab, var(--instrument) 8%, var(--film-panel))"
          : "var(--film-panel)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn("h-3 w-3 shrink-0 rounded-[2px]", isAbstainLike && "hatched")}
          style={{ background: isAbstainLike ? "transparent" : color }}
        />
        <span className="flex-1 truncate text-sm font-medium">
          {finding.display_name}
        </span>
        <span
          className="tabular text-xs"
          style={{ color: finding.included ? color : "var(--film-mid)" }}
        >
          {finding.probability.toFixed(3)}
        </span>
      </div>

      {showBar && (
        <div className="mt-2 flex items-center gap-2">
          <div
            className="relative h-1 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--film-shoulder)" }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, finding.probability * 100)}%`,
                background: color,
              }}
            />
            {/* The calibrated threshold, marked in place so the reader can see
                how far above or below it the score sits. */}
            <div
              className="absolute top-[-2px] h-[5px] w-px"
              style={{
                left: `${Math.min(100, finding.threshold * 100)}%`,
                background: "var(--film-mid)",
              }}
              title={`Conformal threshold ${finding.threshold.toFixed(3)}`}
            />
          </div>
          <span className="tabular w-14 text-right text-[10px] text-[var(--film-mid)]">
            τ {finding.threshold.toFixed(2)}
          </span>
        </div>
      )}
    </Element>
  );
}

export function AbstainBanner({ reason }: { reason: string }) {
  return (
    <div
      className="rounded-sm border p-4"
      style={{
        borderColor: "var(--film-mid)",
        background: "var(--film-panel)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="hatched h-4 w-4 rounded-[2px]" />
        <span className="tabular text-xs font-semibold tracking-[0.18em]">
          ABSTAINED
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--film-mid)]">{reason}</p>
      <p className="mt-2 text-sm">This study requires a radiologist read.</p>
    </div>
  );
}
