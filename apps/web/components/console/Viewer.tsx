"use client";

import { useMemo, useState } from "react";
import type { Study } from "@/lib/types";

/**
 * The image viewer.
 *
 * Stays film-dark in both themes — a radiograph is never read on white, so the
 * viewer is an inset of night inside the light theme.
 *
 * Window and level are the two controls every radiologist reaches for first.
 * They are implemented as CSS brightness/contrast, which is an approximation of
 * true DICOM windowing over 12-bit data; with 8-bit PNGs that is the honest
 * limit and is stated in the tooltip rather than dressed up.
 */
export function Viewer({ study }: { study: Study }) {
  const [windowWidth, setWindowWidth] = useState(100);
  const [level, setLevel] = useState(100);
  const [camOpacity, setCamOpacity] = useState(65);
  const [invert, setInvert] = useState(false);
  const [activeCam, setActiveCam] = useState<string | null>(null);

  const camKeys = useMemo(() => Object.keys(study.gradcam ?? {}), [study.gradcam]);
  const currentCam = activeCam ?? camKeys[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="viewer-surface relative flex-1 overflow-hidden rounded-sm">
        {study.image_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={study.image_url}
              alt={`Radiograph ${study.original_filename || study.id}`}
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                filter: `contrast(${windowWidth}%) brightness(${level}%) ${invert ? "invert(1)" : ""}`,
              }}
            />
            {currentCam && study.gradcam[currentCam] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={study.gradcam[currentCam]}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-screen"
                style={{ opacity: camOpacity / 100 }}
              />
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/40">
            No image
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3">
          <span className="tabular text-[10px] tracking-widest text-white/50">
            {study.patient_ref || "UNASSIGNED"} · #{study.follow_up_index}
          </span>
          <span className="tabular text-[10px] tracking-widest text-white/50">
            {study.mode === "reduced" ? "REDUCED" : "FULL"}
          </span>
        </div>

        {currentCam && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <span className="tabular text-[10px] tracking-widest text-white/50">
              GRAD-CAM · {currentCam.replace(/_/g, " ").toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-3 space-y-2.5">
        <Slider
          label="Window"
          value={windowWidth}
          min={20}
          max={220}
          onChange={setWindowWidth}
          title="Contrast. An 8-bit approximation of DICOM window width."
        />
        <Slider
          label="Level"
          value={level}
          min={30}
          max={200}
          onChange={setLevel}
          title="Brightness. An 8-bit approximation of DICOM window level."
        />
        <Slider
          label="Overlay"
          value={camOpacity}
          min={0}
          max={100}
          onChange={setCamOpacity}
          disabled={!currentCam}
          title="Grad-CAM overlay opacity."
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => setInvert((v) => !v)}
            className="rounded-sm border px-2.5 py-1 text-[11px]"
            style={{
              borderColor: invert ? "var(--instrument)" : "var(--film-shoulder)",
              color: invert ? "var(--instrument)" : "var(--film-mid)",
            }}
          >
            Invert
          </button>
          <button
            onClick={() => {
              setWindowWidth(100);
              setLevel(100);
              setCamOpacity(65);
              setInvert(false);
            }}
            className="rounded-sm border px-2.5 py-1 text-[11px] text-[var(--film-mid)]"
            style={{ borderColor: "var(--film-shoulder)" }}
          >
            Reset
          </button>

          {camKeys.length > 1 && (
            <div className="ml-auto flex flex-wrap gap-1">
              {camKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => setActiveCam(k)}
                  className="rounded-sm border px-2 py-1 text-[11px]"
                  style={{
                    borderColor:
                      currentCam === k ? "var(--instrument)" : "var(--film-shoulder)",
                    color: currentCam === k ? "var(--instrument)" : "var(--film-mid)",
                  }}
                >
                  {k.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  title?: string;
}) {
  const id = `sl-${label.toLowerCase()}`;
  return (
    <div className="flex items-center gap-3" title={title}>
      <label
        htmlFor={id}
        className="tabular w-16 shrink-0 text-[11px] text-[var(--film-mid)]"
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full disabled:opacity-40"
        style={{ accentColor: "var(--instrument)", background: "var(--film-shoulder)" }}
      />
      <span className="tabular w-10 shrink-0 text-right text-[11px] text-[var(--film-mid)]">
        {value}
      </span>
    </div>
  );
}
