"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Volumetric thorax — the hero's signature element.
 *
 * A point cloud sampled from a parametric ribcage, lungs and spine, rotating
 * slowly and leaning toward the cursor. Points near the "lesion" focus take the
 * warning hue, so the cloud shows the same thing the product does: where the
 * model is looking.
 *
 * Why a point cloud and not a mesh: a radiograph IS a volumetric projection, so
 * sampling a volume is the honest 3D analogue. It also costs one draw call and
 * about 40 KB, where a scanned mesh would cost megabytes for no extra meaning.
 *
 * Progressive enhancement is mandatory. The caller renders the 2D hot-light
 * hero when WebGL is unavailable or the user prefers reduced motion — the page
 * never depends on this component existing.
 */

const COUNT = 5200;

function sampleThorax(): { positions: Float32Array; heat: Float32Array } {
  const positions = new Float32Array(COUNT * 3);
  const heat = new Float32Array(COUNT);

  // Deterministic PRNG so the cloud is identical on server and client and does
  // not shimmer between renders.
  let seed = 20260812;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const lesion = new THREE.Vector3(-0.62, -0.35, 0.15);

  for (let i = 0; i < COUNT; i++) {
    const r = rand();
    let x = 0;
    let y = 0;
    let z = 0;

    if (r < 0.13) {
      // spine — a dense central column
      y = rand() * 2.6 - 1.35;
      x = (rand() - 0.5) * 0.14;
      z = (rand() - 0.5) * 0.14;
    } else if (r < 0.5) {
      // ribs — arcs sweeping from the spine around the chest wall
      const rib = Math.floor(rand() * 9);
      const t = rand();
      const side = rand() > 0.5 ? 1 : -1;
      const angle = t * Math.PI * 0.92;
      const radius = 0.55 + rib * 0.028;
      x = side * Math.sin(angle) * radius;
      z = Math.cos(angle) * radius * 0.62;
      y = 0.98 - rib * 0.22 - t * 0.24;
      x += (rand() - 0.5) * 0.03;
      y += (rand() - 0.5) * 0.03;
    } else {
      // lung fields — two hollow-ish ellipsoids
      const side = rand() > 0.5 ? 1 : -1;
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const shell = 0.62 + rand() * 0.38;
      x = side * (0.34 + Math.sin(v) * Math.cos(u) * 0.3 * shell);
      y = Math.cos(v) * 0.62 * shell - 0.06;
      z = Math.sin(v) * Math.sin(u) * 0.26 * shell;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const d = Math.hypot(x - lesion.x, y - lesion.y, z - lesion.z);
    heat[i] = Math.max(0, 1 - d / 0.42);
  }

  return { positions, heat };
}

function Cloud({ pointer }: { pointer: React.RefObject<{ x: number; y: number }> }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, heat } = useMemo(sampleThorax, []);
  const { size } = useThree();

  const colors = useMemo(() => {
    const c = new Float32Array(COUNT * 3);
    const base = new THREE.Color("#5D6B73");
    const instrument = new THREE.Color("#2E9CB8");
    const warn = new THREE.Color("#D9903F");
    const tmp = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const h = heat[i];
      tmp.copy(base).lerp(instrument, 0.55);
      if (h > 0) tmp.lerp(warn, Math.min(h * 1.15, 1));
      c[i * 3] = tmp.r;
      c[i * 3 + 1] = tmp.g;
      c[i * 3 + 2] = tmp.b;
    }
    return c;
  }, [heat]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.16;
    const p = pointer.current ?? { x: 0, y: 0 };
    // Ease toward the cursor rather than tracking it rigidly.
    ref.current.rotation.x += (p.y * 0.32 - ref.current.rotation.x) * 0.05;
    ref.current.position.x += (p.x * 0.12 - ref.current.position.x) * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size.width < 640 ? 0.021 : 0.016}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function Thorax3D() {
  const pointer = useRef({ x: 0, y: 0 });
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
      onPointerLeave={() => {
        pointer.current = { x: 0, y: 0 };
      }}
      role="img"
      aria-label="Rotating volumetric point cloud of a human thorax. A warm region marks where the model's attention concentrates."
    >
      <Canvas
        camera={{ position: [0, 0, 3.1], fov: 42 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor("#0B0D0E", 1)}
        onError={() => setFailed(true)}
      >
        <Cloud pointer={pointer} />
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
