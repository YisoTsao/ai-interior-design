import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { objectDims, type Catalog } from '@interiorai/catalog';
import { findCollisions, objectFootprint, wallQuad } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';

/** 顯示模式（FE-V3D-11）：真實、白模、線框、X 光（牆半透明） */
export type DisplayMode = 'real' | 'clay' | 'wire' | 'xray';
/** 3D 顯示的樓層（FE-LVL-03）：只有目前樓層、全部、目前及以下 */
export type LevelsMode = 'active' | 'all' | 'below';

/**
 * clay／wire：以 scene.overrideMaterial 統一材質。後處理的 OutlinePass 每幀會把 overrideMaterial 設回 null，
 * 所以在渲染前（priority −1）每幀重新套用；材質記在 scene.userData.displayOverride。
 */
export function DisplayModeEffect({ mode }: { mode: DisplayMode }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const mat = useMemo(
    () =>
      mode === 'clay'
        ? new THREE.MeshStandardMaterial({ color: '#f2efea', roughness: 0.95, metalness: 0 })
        : mode === 'wire'
          ? new THREE.MeshBasicMaterial({ color: '#4fd6c8', wireframe: true })
          : null,
    [mode],
  );
  useEffect(() => {
    scene.userData.displayOverride = mat;
    scene.overrideMaterial = mat;
    invalidate();
    return () => {
      scene.userData.displayOverride = null;
      scene.overrideMaterial = null;
      mat?.dispose();
      invalidate();
    };
  }, [mat, scene, invalidate]);
  useFrame(() => {
    scene.overrideMaterial = mat;
  }, -1);
  return null;
}

/** 碰撞與穿牆即時提示（FE-V3D-13）：重疊的家具以紅色半透明框標示 */
export function CollisionBoxes({ level, catalog }: { level: Level; catalog: Catalog }) {
  const boxes = useMemo(() => {
    const inputs = level.objects.map((o) => {
      const e = catalog.get(o.catalogId);
      const d = e ? objectDims(e, o.params, o.scale) : { w: 500, d: 500, h: 500 };
      return {
        id: o.id,
        poly: objectFootprint(o.position, o.rotationY, d.w, d.d),
        ...(e?.anchor ? { anchor: e.anchor } : {}),
        floorCovering: d.h <= 30,
        y0: o.position[1],
        y1: o.position[1] + d.h,
        d,
        o,
      };
    });
    const hit = new Set(
      findCollisions(level, inputs).flatMap((c) => (c.otherId ? [c.objectId, c.otherId] : [c.objectId])),
    );
    return inputs.filter((x) => hit.has(x.id));
  }, [level, catalog]);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.28, depthWrite: false }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <>
      {boxes.map((b) => (
        <mesh
          key={b.id}
          position={[b.o.position[0], b.o.position[1] + b.d.h / 2, b.o.position[2]]}
          rotation={[0, b.o.rotationY, 0]}
          material={mat}
          renderOrder={10}
          raycast={() => null}
          userData={{ gkind: 'collision', id: b.id }}
        >
          <boxGeometry args={[b.d.w + 20, b.d.h + 20, b.d.d + 20]} />
        </mesh>
      ))}
    </>
  );
}

/** 其他樓層（FE-LVL-03）：以白模顯示牆與樓板，位於相對目前樓層的高度 */
export function OtherLevels({ levels, active }: { levels: readonly Level[]; active: Level }) {
  const geos = useMemo(
    () =>
      levels
        .filter((l) => l.id !== active.id)
        .map((l) => {
          const dy = l.elevation - active.elevation;
          const walls = l.walls.map((w) => {
            const q = wallQuad(l.walls, w);
            const shape = new THREE.Shape(q.map((p) => new THREE.Vector2(p[0], -p[1])));
            const g = new THREE.ExtrudeGeometry(shape, { depth: w.height ?? l.height, bevelEnabled: false });
            g.rotateX(-Math.PI / 2);
            return g;
          });
          return { id: l.id, dy, walls };
        }),
    [levels, active],
  );
  useEffect(() => () => geos.forEach((x) => x.walls.forEach((g) => g.dispose())), [geos]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#e9e4dc', transparent: true, opacity: 0.55 }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <>
      {geos.map((l) => (
        <group key={l.id} position={[0, l.dy, 0]} userData={{ gkind: 'otherLevel' }}>
          {l.walls.map((g, i) => (
            <mesh key={i} geometry={g} material={mat} castShadow receiveShadow raycast={() => null} />
          ))}
        </group>
      ))}
    </>
  );
}

/**
 * 3D 測量（FE-V3D-08）：在任何表面點兩下量距離（顯示總長、水平距離、高差）；第三下重新開始，Esc 清除。
 */
export function Measure3D({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const [pts, setPts] = useState<THREE.Vector3[]>([]);
  useEffect(() => {
    if (!active) return setPts([]);
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray
        .intersectObjects(scene.children, true)
        .find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
      const p =
        hit?.point ??
        ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (!p) return;
      setPts((cur) => (cur.length >= 2 ? [p.clone()] : [...cur, p.clone()]));
      invalidate();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPts([]);
    el.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [active, gl, camera, scene, invalidate]);
  if (!active || !pts.length) return null;
  const [a, b] = pts as [THREE.Vector3, THREE.Vector3 | undefined];
  return (
    <group userData={{ gkind: 'measure' }}>
      <mesh position={a} raycast={() => null}>
        <sphereGeometry args={[40, 12, 12]} />
        <meshBasicMaterial color="#ffd166" depthTest={false} />
      </mesh>
      {b && (
        <>
          <mesh position={b} raycast={() => null}>
            <sphereGeometry args={[40, 12, 12]} />
            <meshBasicMaterial color="#ffd166" depthTest={false} />
          </mesh>
          <Line points={[a, b]} color="#ffd166" lineWidth={3} depthTest={false} />
          <Html position={a.clone().add(b).multiplyScalar(0.5)} center zIndexRange={[20, 0]}>
            <div
              className="rounded bg-black/80 px-2 py-1 font-mono text-xs whitespace-nowrap text-[#ffd166]"
              data-testid="measure3d-label"
              data-mm={Math.round(a.distanceTo(b))}
            >
              {`${(a.distanceTo(b) / 1000).toFixed(3)} m`}
              <br />
              {`↔ ${(Math.hypot(b.x - a.x, b.z - a.z) / 1000).toFixed(3)} m · ↕ ${(Math.abs(b.y - a.y) / 1000).toFixed(3)} m`}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** 剖切（FE-V3D-07）：水平剖切高度或垂直剖切（沿 x 或 z 軸的位置），以全域 clippingPlanes 實作 */
export type Section =
  { kind: 'none' } | { kind: 'h'; y: number } | { kind: 'x' | 'z'; value: number; flip?: boolean };
export function SectionPlanes({ section }: { section: Section }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const p =
      section.kind === 'h'
        ? new THREE.Plane(new THREE.Vector3(0, -1, 0), section.y)
        : section.kind === 'x'
          ? new THREE.Plane(
              new THREE.Vector3(section.flip ? 1 : -1, 0, 0),
              section.flip ? -section.value : section.value,
            )
          : section.kind === 'z'
            ? new THREE.Plane(
                new THREE.Vector3(0, 0, section.flip ? 1 : -1),
                section.flip ? -section.value : section.value,
              )
            : null;
    gl.clippingPlanes = p ? [p] : [];
    invalidate();
    return () => {
      gl.clippingPlanes = [];
      invalidate();
    };
  }, [gl, invalidate, section]);
  return null;
}

/**
 * 效能自適應（FE-V3D-12）：互動（有畫格）時量測 FPS，連續 3 秒平均低於 45 → 回呼一次（由宿主降畫質並提示）。
 */
export function PerfWatch({ onLow }: { onLow?: () => void }) {
  const st = useMemo(() => ({ t: 0, n: 0, fired: false, last: 0 }), []);
  useFrame(() => {
    // 自動化測試（headless 軟體算圖）不觸發
    if (!onLow || st.fired || navigator.webdriver) return;
    const now = performance.now();
    const dt = st.last ? now - st.last : 0;
    st.last = now;
    // 需求式渲染：兩畫格間隔 > 200 ms 視為閒置，重新計時
    if (!dt || dt > 200) {
      st.t = 0;
      st.n = 0;
      return;
    }
    st.t += dt;
    st.n++;
    if (st.t >= 3000) {
      const fps = (st.n / st.t) * 1000;
      if (fps < 45) {
        st.fired = true;
        onLow();
      }
      st.t = 0;
      st.n = 0;
    }
  });
  return null;
}

/**
 * 光束方向拖曳把手（FE-LGT-06）：聚光燈的光束落點顯示一顆球，拖曳即改變方向（在視平面上移動），
 * 放開時回傳新的俯仰／水平角（由宿主寫回 light.tiltDeg／panDeg，一次 undo）。
 */
export function BeamHandle({
  position,
  direction,
  color,
  onDragging,
  onCommit,
}: {
  position: [number, number, number];
  direction: [number, number, number];
  color: string;
  onDragging?: (on: boolean) => void;
  onCommit: (worldDir: [number, number, number]) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const P = useMemo(() => new THREE.Vector3(...position), [position]);
  const start = useMemo(() => {
    const d = new THREE.Vector3(...direction).normalize();
    const len = d.y < -0.05 ? Math.max(300, Math.min(6000, P.y / -d.y)) : 1400;
    return P.clone().addScaledVector(d, len);
  }, [P, direction]);
  const [tip, setTip] = useState<THREE.Vector3 | null>(null);
  const at = tip ?? start;
  const line = useMemo(() => [P, at] as [THREE.Vector3, THREE.Vector3], [P, at]);
  return (
    <group userData={{ gkind: 'beamHandle' }}>
      <Line points={line} color={color} lineWidth={2} dashed dashSize={80} gapSize={60} depthTest={false} />
      <mesh
        position={at}
        renderOrder={20}
        data-testid="beam-handle"
        userData={{ gkind: 'beamHandle' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragging?.(true);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()),
            at.clone(),
          );
          const ray = new THREE.Raycaster();
          let last = at.clone();
          const move = (ev: PointerEvent) => {
            const r = gl.domElement.getBoundingClientRect();
            ray.setFromCamera(
              new THREE.Vector2(
                ((ev.clientX - r.left) / r.width) * 2 - 1,
                -((ev.clientY - r.top) / r.height) * 2 + 1,
              ),
              camera,
            );
            const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
            if (hit) {
              last = hit;
              setTip(hit.clone());
              invalidate();
            }
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            onDragging?.(false);
            const d = last.clone().sub(P);
            if (d.lengthSq() > 1) onCommit([d.x, d.y, d.z]);
            setTip(null);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        <sphereGeometry args={[70, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
