"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * The hot light — the signature element.
 *
 * Radiologists hold dense film up to a bright focused lamp to read through it.
 * Here the same gesture reveals what the model attends to: a circular window
 * follows the cursor, and inside it the class-activation overlay is exposed.
 * The product demonstrates itself with no explanatory copy.
 *
 * The radiograph is a hand-drawn SVG illustration, not a real patient image.
 * Presenting a fabricated radiograph as genuine would be dishonest in a
 * clinical context, and using a real one would raise provenance questions the
 * hero cannot answer. It is labelled as an illustration in the DOM.
 *
 * Reduced motion: the lens parks centre-frame and stops tracking, so the
 * effect is still legible without cursor-driven movement.
 */
export function HotLight() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(false);

  const x = useMotionValue(50);
  const y = useMotionValue(45);
  const sx = useSpring(x, { stiffness: 220, damping: 28, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 220, damping: 28, mass: 0.5 });

  const [mask, setMask] = useState("50% 45%");

  useEffect(() => {
    if (reduce) return;
    const unsubX = sx.on("change", (v) => setMask(`${v}% ${sy.get()}%`));
    const unsubY = sy.on("change", (v) => setMask(`${sx.get()}% ${v}%`));
    return () => {
      unsubX();
      unsubY();
    };
  }, [sx, sy, reduce]);

  function track(e: React.MouseEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set(((e.clientX - r.left) / r.width) * 100);
    y.set(((e.clientY - r.top) / r.height) * 100);
  }

  const radius = active && !reduce ? 17 : 13;

  return (
    <div
      ref={ref}
      onMouseMove={track}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => {
        setActive(false);
        x.set(50);
        y.set(45);
      }}
      className="viewer-surface relative aspect-4/5 w-full max-w-md overflow-hidden rounded-sm select-none"
      style={{ boxShadow: "var(--shadow-panel)" }}
      role="img"
      aria-label="Illustration of a chest radiograph. Moving the cursor over it reveals the model's class-activation overlay."
    >
      <Radiograph />

      {/* Activation overlay, revealed only inside the lens. */}
      <div
        className="absolute inset-0 transition-[mask-size] duration-300"
        style={{
          WebkitMaskImage: `radial-gradient(circle at ${mask}, #000 0%, #000 ${radius}%, transparent ${radius + 9}%)`,
          maskImage: `radial-gradient(circle at ${mask}, #000 0%, #000 ${radius}%, transparent ${radius + 9}%)`,
        }}
      >
        <ActivationOverlay />
      </div>

      {/* Lens rim */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          left: `calc(${mask.split(" ")[0]} - ${radius}%)`,
          top: `calc(${mask.split(" ")[1]} - ${radius * 0.8}%)`,
          width: `${radius * 2}%`,
          height: `${radius * 1.6}%`,
          border: "1px solid color-mix(in oklab, var(--instrument) 55%, transparent)",
          boxShadow: "0 0 30px color-mix(in oklab, var(--instrument) 22%, transparent)",
        }}
        animate={{ opacity: active || reduce ? 1 : 0.45 }}
        transition={{ duration: 0.3 }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
        <span className="tabular text-[10px] tracking-widest text-white/45">
          PA · ILLUSTRATION
        </span>
        <span className="tabular text-[10px] tracking-widest text-white/45">
          {active ? "GRAD-CAM" : "MOVE TO READ"}
        </span>
      </div>
    </div>
  );
}

/** Stylised frontal chest radiograph. Drawn, not photographic. */
function Radiograph() {
  return (
    <svg viewBox="0 0 400 500" className="absolute inset-0 h-full w-full">
      <defs>
        <radialGradient id="lungL" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#2b3236" />
          <stop offset="100%" stopColor="#0e1113" />
        </radialGradient>
        <linearGradient id="soft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a4247" />
          <stop offset="100%" stopColor="#14181a" />
        </linearGradient>
        <filter id="grain">
          <feTurbulence baseFrequency="0.85" numOctaves="3" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.055" />
          </feComponentTransfer>
        </filter>
      </defs>

      <rect width="400" height="500" fill="#0b0d0e" />

      {/* soft tissue / mediastinum */}
      <ellipse cx="200" cy="250" rx="150" ry="215" fill="url(#soft)" opacity="0.55" />

      {/* lung fields */}
      <path
        d="M175 105 C140 120 118 190 122 275 C125 345 148 390 178 392 C186 330 186 190 175 105 Z"
        fill="url(#lungL)"
      />
      <path
        d="M225 105 C260 120 282 190 278 275 C275 345 252 390 222 392 C214 330 214 190 225 105 Z"
        fill="url(#lungL)"
      />

      {/* spine */}
      <rect x="192" y="95" width="16" height="310" rx="6" fill="#4a5257" opacity="0.62" />
      {Array.from({ length: 11 }).map((_, i) => (
        <rect
          key={i}
          x="188"
          y={104 + i * 28}
          width="24"
          height="4"
          rx="2"
          fill="#0b0d0e"
          opacity="0.55"
        />
      ))}

      {/* ribs */}
      {Array.from({ length: 8 }).map((_, i) => {
        const y = 128 + i * 32;
        const w = 74 + i * 5;
        return (
          <g key={i} stroke="#5b646a" strokeWidth="3.2" fill="none" opacity={0.5}>
            <path d={`M196 ${y} q -${w} ${16 + i * 3} -${w - 14} ${52 + i * 4}`} />
            <path d={`M204 ${y} q ${w} ${16 + i * 3} ${w - 14} ${52 + i * 4}`} />
          </g>
        );
      })}

      {/* clavicles */}
      <path d="M196 118 q -62 -16 -88 6" stroke="#666f75" strokeWidth="5" fill="none" opacity="0.6" />
      <path d="M204 118 q 62 -16 88 6" stroke="#666f75" strokeWidth="5" fill="none" opacity="0.6" />

      {/* cardiac silhouette */}
      <path
        d="M200 250 C176 250 152 288 156 330 C160 368 186 392 214 392 C246 392 264 362 262 326 C260 286 232 250 200 250 Z"
        fill="#394146"
        opacity="0.78"
      />

      {/* diaphragm */}
      <path d="M110 392 q 90 34 180 0" stroke="#5b646a" strokeWidth="4" fill="none" opacity="0.55" />

      <rect width="400" height="500" filter="url(#grain)" opacity="0.6" />
    </svg>
  );
}

/** The heat map revealed under the lens. Colour lives here and nowhere else. */
function ActivationOverlay() {
  return (
    <svg viewBox="0 0 400 500" className="absolute inset-0 h-full w-full">
      <defs>
        <radialGradient id="cam1">
          <stop offset="0%" stopColor="#d64541" stopOpacity="0.92" />
          <stop offset="42%" stopColor="#d9903f" stopOpacity="0.68" />
          <stop offset="72%" stopColor="#2e9cb8" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#2e9cb8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cam2">
          <stop offset="0%" stopColor="#d9903f" stopOpacity="0.72" />
          <stop offset="55%" stopColor="#2e9cb8" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#2e9cb8" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Right lower zone — where a basal effusion would collect. */}
      <ellipse cx="152" cy="330" rx="74" ry="58" fill="url(#cam1)" />
      <ellipse cx="262" cy="212" rx="52" ry="44" fill="url(#cam2)" />
    </svg>
  );
}
