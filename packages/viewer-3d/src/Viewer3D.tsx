import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { useStore } from 'zustand';
import { activeLevel, transformObject, type EditorStore } from '@interiorai/app-state';
import { materialMap, objectDims, type Catalog, type Material } from '@interiorai/catalog';
import { pointOnWall, wallLength } from '@interiorai/core-geometry';
import type { Level, SceneObject } from '@interiorai/scene-schema';
import { viewer3dApi } from './api.js';
import { buildFurnitureGeometry, buildOpeningFill, variantKey } from './furniture.js';
import { MaterialCache, ResourceScope } from './resources.js';
import { buildRoomSurfaces, buildWallGeometry } from './walls3d.js';

export interface Viewer3DProps {
  store: EditorStore;
  catalog: Catalog;
  materials: readonly Material[];
  theme: { bg: string; primary: string; warn: string };
  transformMode: 'translate' | 'rotate' | 'scale';
  uniformScale: boolean;
  showCeiling?: boolean;
}

export function Viewer3D(props: Viewer3DProps) {
  const [ctxKey, setCtxKey] = useState(0);
  return (
    <div className="h-full w-full" data-testid="viewer3d" style={{ background: props.theme.bg }}>
      <Canvas
        key={ctxKey}
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 50, near: 10, far: 1_000_000, position: [6000, 9000, 12000] }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          // 03 §8：WebGL context lost → 等待 restored 後重建
          gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
          gl.domElement.addEventListener('webglcontextrestored', () => setCtxKey((k) => k + 1));
        }}
        onPointerMissed={(e) => {
          if (e.button === 0) props.store.getState().select([]);
        }}
      >
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}

function SceneContent({
  store,
  catalog,
  materials,
  theme,
  transformMode,
  uniformScale,
  showCeiling,
}: Viewer3DProps) {
  const scene = useStore(store, (s) => s.scene);
  const levelId = useStore(store, (s) => s.levelId);
  const selection = useStore(store, (s) => s.selection);
  const layers = useStore(store, (s) => s.layers);
  const level = useMemo(() => activeLevel({ scene, levelId }), [scene, levelId]);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitImpl>(null);

  const scope = useMemo(() => new ResourceScope(), []);
  const lib = useMemo(() => materialMap(materials), [materials]);
  const mats = useMemo(() => new MaterialCache(scope, lib), [scope, lib]);
  const capMat = useMemo(
    () => scope.track(new THREE.MeshStandardMaterial({ color: '#8f8b84', roughness: 1 })),
    [scope],
  );
  const vcMat = useMemo(
    () => scope.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })),
    [scope],
  );
  const selMat = useMemo(
    () =>
      scope.track(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.8,
          emissive: new THREE.Color(theme.primary),
          emissiveIntensity: 0.25,
        }),
      ),
    [scope, theme.primary],
  );
  useEffect(() => () => scope.disposeAll(), [scope]);

  // 只含結構的樓層：物件變動時參照不變 → 牆/地板不重建（Immer 結構共享）
  const { id: lid, elevation: lel, height: lh, walls: lw, openings: lo, rooms: lr } = level;
  const structure = useMemo<Level>(
    () => ({ id: lid, elevation: lel, height: lh, walls: lw, openings: lo, rooms: lr, objects: [] }),
    [lid, lel, lh, lw, lo, lr],
  );
  const walls = useMemo(
    () => structure.walls.map((w) => ({ w, geom: scope.track(buildWallGeometry(structure, w)) })),
    [structure, scope],
  );
  useEffect(() => () => walls.forEach((x) => scope.release(x.geom)), [walls, scope]);
  const rooms = useMemo(
    () =>
      buildRoomSurfaces(structure).map((r) => ({
        ...r,
        floor: scope.track(r.floor),
        ceiling: scope.track(r.ceiling),
      })),
    [structure, scope],
  );
  useEffect(
    () => () => rooms.forEach((r) => (scope.release(r.floor), scope.release(r.ceiling))),
    [rooms, scope],
  );
  const fills = useMemo(
    () =>
      level.openings.flatMap((o) => {
        const w = level.walls.find((x) => x.id === o.wallId);
        const g = w ? buildOpeningFill(o.type, o.width, o.height, Math.min(w.thickness, 80)) : null;
        if (!w || !g) return [];
        const c = pointOnWall(w, o.offset + o.width / 2);
        const len = wallLength(w);
        return [
          {
            o,
            geom: scope.track(g),
            pos: [c[0], o.sill ?? 0, c[1]] as const,
            rotY: Math.atan2(-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len),
          },
        ];
      }),
    [level.openings, level.walls, scope],
  );
  useEffect(() => () => fills.forEach((f) => scope.release(f.geom)), [fills, scope]);

  // 家具幾何快取（變體鍵）
  const furnGeoms = useRef(new Map<string, THREE.BufferGeometry>());
  const geomFor = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    const k = variantKey(e, o.catalogId, o.params);
    let g = furnGeoms.current.get(k);
    if (!g) {
      g = scope.track(buildFurnitureGeometry(e, o.params));
      furnGeoms.current.set(k, g);
    }
    return { key: k, g };
  };
  useEffect(() => {
    const m = furnGeoms.current;
    return () => m.clear();
  }, [scope]);

  const single = selection.length === 1 ? level.objects.find((o) => o.id === selection[0]) : undefined;
  const selSet = useMemo(() => new Set(selection), [selection]);
  const groups = useMemo(() => {
    const map = new Map<string, { g: THREE.BufferGeometry; objs: SceneObject[] }>();
    if (!layers.furniture) return [];
    for (const o of level.objects) {
      if (single && o.id === single.id) continue;
      const { key, g } = geomFor(o);
      const cur = map.get(key) ?? { g, objs: [] };
      cur.objs.push(o);
      map.set(key, cur);
    }
    return [...map.entries()];
  }, [level.objects, single, layers.furniture, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyColor = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    const slot = e?.materialSlots[0];
    return mats.colorOf(o.materialOverrides?.[slot?.name ?? 'body'] ?? slot?.defaultMaterialId, '#cfc6b8');
  };

  const bbox = useMemo(() => {
    const b = new THREE.Box3();
    for (const w of level.walls) {
      b.expandByPoint(new THREE.Vector3(w.a[0], 0, w.a[1]));
      b.expandByPoint(new THREE.Vector3(w.b[0], level.height, w.b[1]));
    }
    for (const o of level.objects)
      b.expandByPoint(new THREE.Vector3(o.position[0], o.position[1], o.position[2]));
    if (b.isEmpty()) b.set(new THREE.Vector3(-1000, 0, -1000), new THREE.Vector3(7000, 2800, 5000));
    return b;
  }, [level]);

  const frameAll = () => {
    const c = bbox.getCenter(new THREE.Vector3());
    const r = Math.max(4000, bbox.getSize(new THREE.Vector3()).length());
    camera.position.set(c.x + r * 0.55, r * 0.8, c.z + r * 0.75);
    controls.current?.target.set(c.x, 0, c.z);
    controls.current?.update();
    invalidate();
  };
  const framed = useRef(false);
  useEffect(() => {
    if (!framed.current) {
      framed.current = true;
      frameAll();
    }
  });

  useEffect(() => {
    viewer3dApi.set({
      info: () => ({
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        trackedResources: scope.size,
      }),
      bench: (ms) =>
        new Promise((resolve) => {
          const target = controls.current?.target.clone() ?? new THREE.Vector3();
          const r0 = camera.position.clone().sub(target);
          const frames: number[] = [];
          let calls = 0;
          let tris = 0;
          const t0 = performance.now();
          let last = t0;
          const step = () => {
            const now = performance.now();
            frames.push(now - last);
            last = now;
            const a = ((now - t0) / 4000) * Math.PI * 2;
            camera.position.set(
              target.x + r0.x * Math.cos(a) - r0.z * Math.sin(a),
              target.y + r0.y,
              target.z + r0.x * Math.sin(a) + r0.z * Math.cos(a),
            );
            camera.lookAt(target);
            gl.info.autoReset = true;
            invalidate();
            calls = Math.max(calls, gl.info.render.calls);
            tris = Math.max(tris, gl.info.render.triangles);
            if (now - t0 < ms) requestAnimationFrame(step);
            else {
              const sorted = frames.slice(1).sort((x, y) => x - y);
              resolve({
                fps: (sorted.length / (now - t0)) * 1000,
                p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
                drawCalls: calls,
                triangles: tris,
                frames: sorted.length,
              });
            }
          };
          requestAnimationFrame(step);
        }),
      personView: () => {
        const c = bbox.getCenter(new THREE.Vector3());
        camera.position.set(bbox.min.x + 600, 1600, c.z);
        controls.current?.target.set(c.x, 1400, c.z);
        controls.current?.update();
        invalidate();
      },
      frameAll,
      currentCamera: () => {
        const t = controls.current?.target ?? new THREE.Vector3();
        return {
          position: [camera.position.x, camera.position.y, camera.position.z].map(Math.round) as [
            number,
            number,
            number,
          ],
          target: [t.x, t.y, t.z].map(Math.round) as [number, number, number],
          fovDeg: (camera as THREE.PerspectiveCamera).fov,
        };
      },
    });
    return () => viewer3dApi.set(null);
  });

  const select = (id: string | undefined) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (id) store.getState().select([id], e.nativeEvent.shiftKey);
  };

  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <hemisphereLight args={['#ffffff', '#b9b2a6', 1.6]} />
      <directionalLight position={[8000, 12000, 6000]} intensity={1.4} />
      <OrbitControls ref={controls} makeDefault enableDamping={false} maxPolarAngle={Math.PI * 0.495} />
      {layers.structure &&
        walls.map(({ w, geom }) => (
          <mesh
            key={w.id}
            geometry={geom}
            material={[
              mats.get(w.materialId, '#efece6'),
              mats.get(w.materialIdB ?? w.materialId, '#efece6'),
              selSet.has(w.id) ? selMat : capMat,
            ]}
            onClick={select(w.id)}
            userData={{ id: w.id }}
          />
        ))}
      {layers.structure &&
        rooms.map((r) => {
          const room = level.rooms.find((x) => x.id === r.roomId);
          return (
            <group key={r.key}>
              <mesh
                geometry={r.floor}
                material={mats.get(room?.floorMaterialId, '#d8d2c6')}
                onClick={select(r.roomId)}
                userData={{ id: r.roomId }}
              />
              {showCeiling && (
                <mesh
                  geometry={r.ceiling}
                  material={mats.get(room?.ceilingMaterialId ?? 'mat_ceiling_white', '#fafaf7')}
                />
              )}
            </group>
          );
        })}
      {layers.structure &&
        fills.map((f) => (
          <mesh
            key={f.o.id}
            geometry={f.geom}
            material={selSet.has(f.o.id) ? selMat : vcMat}
            position={f.pos as unknown as [number, number, number]}
            rotation={[0, f.rotY, 0]}
            onClick={select(f.o.id)}
          />
        ))}
      {groups.map(([key, grp]) => (
        <FurnitureInstances
          key={key}
          geom={grp.g}
          objs={grp.objs}
          material={vcMat}
          colorOf={bodyColor}
          selected={selSet}
          highlight={theme.primary}
          onPick={(id, additive) => store.getState().select([id], additive)}
        />
      ))}
      {single && layers.furniture && (
        <SelectedObject
          key={single.id}
          obj={single}
          geom={geomFor(single).g}
          material={selMat}
          color={bodyColor(single)}
          level={level}
          mode={transformMode}
          uniform={uniformScale}
          catalog={catalog}
          onCommit={(t) => store.getState().exec(transformObject(level.id, single.id, t))}
        />
      )}
    </>
  );
}

function FurnitureInstances({
  geom,
  objs,
  material,
  colorOf,
  selected,
  highlight,
  onPick,
}: {
  geom: THREE.BufferGeometry;
  objs: SceneObject[];
  material: THREE.Material;
  colorOf: (o: SceneObject) => THREE.Color;
  selected: Set<string>;
  highlight: string;
  onPick: (id: string, additive: boolean) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const hl = new THREE.Color(highlight);
    objs.forEach((o, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotationY);
      const s = o.scale ?? [1, 1, 1];
      mat.compose(
        new THREE.Vector3(o.position[0], o.position[1], o.position[2]),
        q,
        new THREE.Vector3(s[0], s[1], s[2]),
      );
      m.setMatrixAt(i, mat);
      const c = colorOf(o);
      m.setColorAt(i, selected.has(o.id) ? c.lerp(hl, 0.45) : c);
    });
    m.count = objs.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    invalidate();
  });
  return (
    <instancedMesh
      ref={ref}
      args={[geom, material, objs.length]}
      onClick={(e) => {
        e.stopPropagation();
        const o = e.instanceId !== undefined ? objs[e.instanceId] : undefined;
        if (o) onPick(o.id, e.nativeEvent.shiftKey);
      }}
    />
  );
}

function SelectedObject({
  obj,
  geom,
  material,
  color,
  level,
  mode,
  uniform,
  catalog,
  onCommit,
}: {
  obj: SceneObject;
  geom: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  level: Level;
  mode: Viewer3DProps['transformMode'];
  uniform: boolean;
  catalog: Catalog;
  onCommit: (t: {
    position?: [number, number, number];
    rotationY?: number;
    scale?: [number, number, number];
  }) => void;
}) {
  const proxy = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(false);
  const mat = useMemo(() => {
    const m = material.clone();
    m.color = color;
    return m;
  }, [material, color]);
  useEffect(() => () => mat.dispose(), [mat]);
  useLayoutEffect(() => setReady(true), []);
  const entry = catalog.get(obj.catalogId);
  const s = obj.scale ?? [1, 1, 1];

  const commit = () => {
    const p = proxy.current;
    if (!p) return;
    const sc: [number, number, number] = [p.scale.x, p.scale.y, p.scale.z];
    const dims = entry ? objectDims(entry, obj.params, sc) : { h: 0 };
    // 地面/天花吸附（03 §5）：y 依 anchor 決定
    const y = entry?.anchor === 'ceiling' ? level.height - dims.h : obj.position[1];
    const changed =
      Math.round(p.position.x) !== obj.position[0] ||
      Math.round(p.position.z) !== obj.position[2] ||
      Math.abs(p.rotation.y - obj.rotationY) > 1e-6 ||
      sc.some((v, i) => Math.abs(v - (s[i] ?? 1)) > 1e-6);
    if (changed)
      onCommit({
        position: [Math.round(p.position.x), Math.round(y), Math.round(p.position.z)],
        rotationY: p.rotation.y,
        scale: sc,
      });
  };

  return (
    <>
      <group
        ref={proxy}
        position={[obj.position[0], obj.position[1], obj.position[2]]}
        rotation={[0, obj.rotationY, 0]}
        scale={[s[0], s[1], s[2]]}
      >
        <mesh geometry={geom} material={mat} />
      </group>
      {ready && proxy.current && !obj.locked && (
        <TransformControls
          object={proxy.current}
          mode={mode}
          showY={mode !== 'translate'}
          showX={mode !== 'rotate'}
          showZ={mode !== 'rotate'}
          rotationSnap={Math.PI / 12}
          translationSnap={10}
          size={0.8}
          onObjectChange={() => {
            const p = proxy.current!;
            if (mode === 'scale' && uniform) {
              // 預設等比縮放（B3.6）：取變化最大的軸
              const d = [p.scale.x - s[0]!, p.scale.y - s[1]!, p.scale.z - s[2]!];
              const k = d.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
              const base = s[0]!;
              const f = (base + k) / base;
              p.scale.set(s[0]! * f, s[1]! * f, s[2]! * f);
            }
            if (p.scale.x < 0.05 || p.scale.y < 0.05 || p.scale.z < 0.05)
              p.scale.set(Math.max(0.05, p.scale.x), Math.max(0.05, p.scale.y), Math.max(0.05, p.scale.z));
          }}
          onMouseUp={commit}
        />
      )}
    </>
  );
}
