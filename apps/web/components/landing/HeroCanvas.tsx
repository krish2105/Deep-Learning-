"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * Full-viewport volumetric thorax.
 *
 * This is the hero — it occupies the entire first screen and stays fixed
 * behind the page as it scrolls, rather than sitting in a small panel. The
 * cloud assembles from scattered particles into a ribcage as you scroll, then
 * the attention focus warms.
 *
 * Fixed-position canvas rather than one per section: a single WebGL context
 * for the whole page. Multiple canvases would each hold their own context, and
 * browsers cap those at around sixteen before silently dropping the oldest.
 */

const COUNT = 14000;

function build() {
  const target = new Float32Array(COUNT * 3);
  const scattered = new Float32Array(COUNT * 3);
  const heat = new Float32Array(COUNT);

  let seed = 20260812;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const lesion = new THREE.Vector3(-0.62, -0.35, 0.15);

  for (let i = 0; i < COUNT; i++) {
    const r = rand();
    let x = 0, y = 0, z = 0;

    if (r < 0.10) {
      // spine
      y = rand() * 2.6 - 1.35;
      x = (rand() - 0.5) * 0.13;
      z = (rand() - 0.5) * 0.13;
    } else if (r < 0.30) {
      // vertebral processes — short lateral spurs, so the spine reads as bone
      const step = Math.floor(rand() * 12);
      y = 1.05 - step * 0.2;
      x = (rand() - 0.5) * 0.42;
      z = (rand() - 0.5) * 0.1;
    } else if (r < 0.62) {
      // ribs
      const rib = Math.floor(rand() * 10);
      const t = rand();
      const side = rand() > 0.5 ? 1 : -1;
      const angle = t * Math.PI * 0.95;
      const radius = 0.58 + rib * 0.026;
      x = side * Math.sin(angle) * radius;
      z = Math.cos(angle) * radius * 0.6;
      y = 1.0 - rib * 0.21 - t * 0.22;
      x += (rand() - 0.5) * 0.022;
      y += (rand() - 0.5) * 0.022;
    } else if (r < 0.70) {
      // clavicles
      const side = rand() > 0.5 ? 1 : -1;
      const t = rand();
      x = side * t * 0.86;
      y = 1.12 - Math.sin(t * Math.PI) * 0.1;
      z = (rand() - 0.5) * 0.08;
    } else {
      // lung fields
      const side = rand() > 0.5 ? 1 : -1;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const shell = 0.6 + rand() * 0.4;
      x = side * (0.35 + Math.sin(v) * Math.cos(u) * 0.3 * shell);
      y = Math.cos(v) * 0.64 * shell - 0.05;
      z = Math.sin(v) * Math.sin(u) * 0.26 * shell;
    }

    target.set([x, y, z], i * 3);

    const su = rand() * Math.PI * 2;
    const sv = Math.acos(2 * rand() - 1);
    const sr = 3.0 + rand() * 2.4;
    scattered.set(
      [
        Math.sin(sv) * Math.cos(su) * sr,
        Math.cos(sv) * sr * 0.75,
        Math.sin(sv) * Math.sin(su) * sr,
      ],
      i * 3,
    );

    heat[i] = Math.max(
      0,
      1 - Math.hypot(x - lesion.x, y - lesion.y, z - lesion.z) / 0.44,
    );
  }
  return { target, scattered, heat };
}

function Thorax({ progress }: { progress: React.RefObject<number> }) {
  const ref = useRef<THREE.Points>(null);
  const { target, scattered, heat } = useMemo(build, []);
  const { size } = useThree();

  const positions = useMemo(() => new Float32Array(scattered), [scattered]);

  const { cold, warm } = useMemo(() => {
    const base = new THREE.Color("#46545C");
    const instrument = new THREE.Color("#2E9CB8");
    const warnC = new THREE.Color("#D9903F");
    const c = new Float32Array(COUNT * 3);
    const w = new Float32Array(COUNT * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      tmp.copy(base).lerp(instrument, 0.45);
      c.set([tmp.r, tmp.g, tmp.b], i * 3);
      tmp.lerp(warnC, Math.min(heat[i] * 1.25, 1));
      w.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    return { cold: c, warm: w };
  }, [heat]);

  const colorAttr = useMemo(() => new Float32Array(cold), [cold]);
  const eased = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });

  useFrame((state, delta) => {
    if (!ref.current) return;
    const dt = Math.min(delta, 0.05); // clamp so a stalled tab does not jump

    const goal = progress.current ?? 0;
    eased.current += (goal - eased.current) * Math.min(dt * 3, 1);
    const t = Math.min(Math.max(eased.current, 0), 1);
    const e = 1 - Math.pow(1 - t, 3);

    const geom = ref.current.geometry;
    const pos = geom.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT * 3; i++) {
      pos[i] = scattered[i] + (target[i] - scattered[i]) * e;
    }
    geom.attributes.position.needsUpdate = true;

    const heatMix = Math.max(0, (e - 0.6) / 0.4);
    if (heatMix > 0.001) {
      const col = geom.attributes.color.array as Float32Array;
      for (let i = 0; i < COUNT * 3; i++) {
        col[i] = cold[i] + (warm[i] - cold[i]) * heatMix;
      }
      geom.attributes.color.needsUpdate = true;
    }

    pointer.current.x += (state.pointer.x - pointer.current.x) * 0.04;
    pointer.current.y += (state.pointer.y - pointer.current.y) * 0.04;

    ref.current.rotation.y += dt * 0.11;
    ref.current.rotation.x = pointer.current.y * 0.22;
    ref.current.position.x = pointer.current.x * 0.18;
    // Recede slightly as the page scrolls so text stays legible over it.
    ref.current.position.z = -e * 0.45;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colorAttr, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size.width < 768 ? 0.016 : 0.0115}
        vertexColors
        transparent
        opacity={0.95}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function HeroCanvas({
  progress,
}: {
  progress: React.RefObject<number>;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.6], fov: 46 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Thorax progress={progress} />
    </Canvas>
  );
}
