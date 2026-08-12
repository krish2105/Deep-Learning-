"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Volumetric thorax that assembles as you scroll.
 *
 * Points begin scattered in a diffuse cloud and converge onto a parametric
 * ribcage, lungs and spine as scroll progresses — then the attention focus
 * warms. The gesture mirrors what the system does: unstructured signal
 * resolving into localised evidence.
 *
 * A point cloud rather than a mesh because a radiograph IS a volumetric
 * projection, so sampling a volume is the honest 3D analogue. It also costs one
 * draw call; a scanned mesh would cost megabytes for no extra meaning.
 *
 * Progressive enhancement is mandatory — HeroVisual renders the 2D hot-light
 * hero whenever WebGL is missing or motion is reduced.
 */

const COUNT = 6000;

function sample() {
  const target = new Float32Array(COUNT * 3);
  const scattered = new Float32Array(COUNT * 3);
  const heat = new Float32Array(COUNT);

  // Deterministic PRNG: the cloud must be identical every render, or it
  // shimmers as React re-mounts.
  let seed = 20260812;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const lesion = new THREE.Vector3(-0.62, -0.35, 0.15);

  for (let i = 0; i < COUNT; i++) {
    const r = rand();
    let x = 0, y = 0, z = 0;

    if (r < 0.13) {
      y = rand() * 2.6 - 1.35;
      x = (rand() - 0.5) * 0.14;
      z = (rand() - 0.5) * 0.14;
    } else if (r < 0.52) {
      const rib = Math.floor(rand() * 9);
      const t = rand();
      const side = rand() > 0.5 ? 1 : -1;
      const angle = t * Math.PI * 0.92;
      const radius = 0.55 + rib * 0.028;
      x = side * Math.sin(angle) * radius;
      z = Math.cos(angle) * radius * 0.62;
      y = 0.98 - rib * 0.22 - t * 0.24;
    } else {
      const side = rand() > 0.5 ? 1 : -1;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const shell = 0.62 + rand() * 0.38;
      x = side * (0.34 + Math.sin(v) * Math.cos(u) * 0.3 * shell);
      y = Math.cos(v) * 0.62 * shell - 0.06;
      z = Math.sin(v) * Math.sin(u) * 0.26 * shell;
    }

    target[i * 3] = x;
    target[i * 3 + 1] = y;
    target[i * 3 + 2] = z;

    // Scattered start: a wide shell the points fall inward from.
    const su = rand() * Math.PI * 2;
    const sv = Math.acos(2 * rand() - 1);
    const sr = 2.4 + rand() * 1.6;
    scattered[i * 3] = Math.sin(sv) * Math.cos(su) * sr;
    scattered[i * 3 + 1] = Math.cos(sv) * sr * 0.8;
    scattered[i * 3 + 2] = Math.sin(sv) * Math.sin(su) * sr;

    heat[i] = Math.max(
      0,
      1 - Math.hypot(x - lesion.x, y - lesion.y, z - lesion.z) / 0.42,
    );
  }
  return { target, scattered, heat };
}

function Cloud({
  pointer,
  progress,
}: {
  pointer: React.RefObject<{ x: number; y: number }>;
  progress: React.RefObject<number>;
}) {
  const ref = useRef<THREE.Points>(null);
  const { target, scattered, heat } = useMemo(sample, []);

  // One buffer mutated per frame — allocating 6000 vec3s each frame would
  // dominate the frame budget and thrash the GC.
  const positions = useMemo(() => new Float32Array(scattered), [scattered]);

  const { colors, warm } = useMemo(() => {
    const base = new THREE.Color("#4E5D66");
    const instrument = new THREE.Color("#2E9CB8");
    const warnColor = new THREE.Color("#D9903F");
    const c = new Float32Array(COUNT * 3);
    const w = new Float32Array(COUNT * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      tmp.copy(base).lerp(instrument, 0.5);
      c.set([tmp.r, tmp.g, tmp.b], i * 3);
      tmp.copy(base).lerp(instrument, 0.5).lerp(warnColor, Math.min(heat[i] * 1.2, 1));
      w.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    return { colors: c, warm: w };
  }, [heat]);

  const colorAttr = useMemo(() => new Float32Array(colors), [colors]);
  const assembled = useRef(0);

  useFrame((_state, delta) => {
    if (!ref.current) return;

    // Ease toward the scroll target so the assembly never snaps.
    const goal = progress.current ?? 0;
    assembled.current += (goal - assembled.current) * Math.min(delta * 3.2, 1);
    const t = assembled.current;
    // easeOutCubic: fast convergence, gentle settle
    const e = 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

    const geom = ref.current.geometry;
    const pos = geom.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT * 3; i++) {
      pos[i] = scattered[i] + (target[i] - scattered[i]) * e;
    }
    geom.attributes.position.needsUpdate = true;

    // Heat only appears once the anatomy is legible — showing the model's
    // attention on an unresolved cloud would be meaningless.
    const heatMix = Math.max(0, (e - 0.65) / 0.35);
    if (heatMix > 0) {
      const col = geom.attributes.color.array as Float32Array;
      for (let i = 0; i < COUNT * 3; i++) {
        col[i] = colors[i] + (warm[i] - colors[i]) * heatMix;
      }
      geom.attributes.color.needsUpdate = true;
    }

    ref.current.rotation.y += delta * 0.14;
    const p = pointer.current ?? { x: 0, y: 0 };
    ref.current.rotation.x += (p.y * 0.3 - ref.current.rotation.x) * 0.05;
    ref.current.position.x += (p.x * 0.1 - ref.current.position.x) * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colorAttr, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.017}
        vertexColors
        transparent
        opacity={0.92}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function Thorax3D({
  progress,
}: {
  /** 0 = scattered, 1 = fully assembled. Driven by scroll. */
  progress?: React.RefObject<number>;
}) {
  const pointer = useRef({ x: 0, y: 0 });
  const internal = useRef(1);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div
      className="viewer-surface relative aspect-4/5 w-full max-w-md overflow-hidden rounded-sm"
      style={{ boxShadow: "var(--shadow-panel)" }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = {
          x: ((e.clientX - r.left) / r.width) * 2 - 1,
          y: ((e.clientY - r.top) / r.height) * 2 - 1,
        };
      }}
      onPointerLeave={() => (pointer.current = { x: 0, y: 0 })}
      role="img"
      aria-label="A volumetric point cloud of a human thorax that assembles as the page scrolls, with a warm region marking where the model's attention concentrates."
    >
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 42 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor("#0B0D0E", 1)}
        onError={() => setFailed(true)}
      >
        <Cloud pointer={pointer} progress={progress ?? internal} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
        <span className="tabular text-[10px] tracking-widest text-white/45">
          VOLUME · ILLUSTRATION
        </span>
        <span className="tabular text-[10px] tracking-widest text-white/45">
          ATTENTION FOCUS
        </span>
      </div>
    </div>
  );
}
