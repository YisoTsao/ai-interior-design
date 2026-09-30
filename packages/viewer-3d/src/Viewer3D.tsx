import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { useStore } from 'zustand';
import { DEFAULTS, activeLevel, transformObject, type EditorStore } from '@interiorai/app-state';
import { materialMap, objectDims, resolveParams, type Catalog, type Material } from '@interiorai/catalog';
import { buildingFootprint, offsetPolygon, pointOnWall, wallLength } from '@interiorai/core-geometry';
import type { Level, SceneObject, Wall } from '@interiorai/scene-schema';
import { viewer3dApi } from './api.js';
import { renderGBuffer } from './gbuffer.js';
import { DollhouseStage, type QualityState } from './DollhouseStage.js';
import { buildFurnitureGeometry, buildOpeningFill, styledVariantKey, variantKey } from './furniture.js';
import { fixtureLights, lightColorHex, pickActive, windowLights, type LightingMode } from './lighting.js';
import { FixtureLights, Plinth } from './NightScene.js';
import { MaterialCache, ResourceScope } from './resources.js';
import {
  DOLLHOUSE,
  NIGHT,
  STYLE_MATERIALS,
  VIEW_PRESETS,
  classifyWalls,
  dollhouseFloorMaterial,
  fitDistance,
  fullHeightWalls,
  mutedColor,
  presetDirection,
  sameSet,
  type ViewPreset,
  type ViewStyle,
} from './style.js';
import { buildRoomSurfaces, buildWallGeometry } from './walls3d.js';

export interface Viewer3DProps {
  store: EditorStore;
  catalog: Catalog;
  materials: readonly Material[];
  theme: { bg: string; primary: string; warn: string };
  transformMode: 'translate' | 'rotate' | 'scale';
  uniformScale: boolean;
  showCeiling?: boolean;
  /** 視覺風格；預設 simple（P2 原行為）。切換時重建 Canvas，確保兩種模式互不殘留狀態 */
  viewStyle?: ViewStyle;
  /** 剖面模型的光線：day＝日光（images2）、night＝夜間氛圍（images1，燈具為主光源）；預設 day */
  lighting?: LightingMode;
}

const DH_CAMERA = {
  fov: DOLLHOUSE.fovDeg,
  near: 100,
  far: 500_000,
  position: [20000, 16000, 20000] as const,
};

export function Viewer3D(props: Viewer3DProps) {
  const [ctxKey, setCtxKey] = useState(0);
  const dh = props.viewStyle === 'dollhouse';
  const night = dh && props.lighting === 'night';
  return (
    <div
      className="h-full w-full"
      data-testid="viewer3d"
      data-style={dh ? 'dollhouse' : 'simple'}
      data-lighting={dh ? (night ? 'night' : 'day') : 'none'}
      style={{ background: night ? NIGHT.background.edge : dh ? '#ddd5ca' : props.theme.bg }}
    >
      <Canvas
        key={`${ctxKey}-${dh ? 'dh' : 'simple'}-${night ? 'night' : 'day'}`}
        frameloop="demand"
        dpr={[1, 2]}
        shadows={dh ? { enabled: true, type: THREE.PCFShadowMap } : false}
        camera={
          dh
            ? { ...DH_CAMERA, position: [...DH_CAMERA.position] }
            : { fov: 50, near: 10, far: 1_000_000, position: [6000, 9000, 12000] }
        }
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
  viewStyle,
  lighting,
}: Viewer3DProps) {
  const dh = viewStyle === 'dollhouse';
  const night = dh && lighting === 'night';
  const scene = useStore(store, (s) => s.scene);
  const levelId = useStore(store, (s) => s.levelId);
  const selection = useStore(store, (s) => s.selection);
  const layers = useStore(store, (s) => s.layers);
  const level = useMemo(() => activeLevel({ scene, levelId }), [scene, levelId]);
  const gl = useThree((s) => s.gl);
  const scene3 = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitImpl>(null);

  const scope = useMemo(() => new ResourceScope(), []);
  const lib = useMemo(
    () => materialMap(dh ? [...materials, ...STYLE_MATERIALS] : materials),
    [materials, dh],
  );
  const mats = useMemo(
    () =>
      new MaterialCache(
        scope,
        lib,
        dh
          ? {
              hq: true,
              wallRoughness: DOLLHOUSE.wallRoughness,
              ...(night ? { floorRoughness: NIGHT.floorRoughness } : {}),
            }
          : {},
      ),
    [scope, lib, dh, night],
  );
  const capMat = useMemo(
    () =>
      scope.track(
        dh
          ? new THREE.MeshStandardMaterial({ color: DOLLHOUSE.capColor, roughness: 0.9 })
          : new THREE.MeshStandardMaterial({ color: '#8f8b84', roughness: 1 }),
      ),
    [scope, dh],
  );
  const glassMat = useMemo(
    () =>
      scope.track(
        night
          ? // 夜間：窗外是明亮的天光（images1），玻璃自發光並產生光暈
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(NIGHT.window.color).multiplyScalar(NIGHT.window.emissive),
            })
          : new THREE.MeshStandardMaterial({
              color: DOLLHOUSE.glassColor,
              transparent: true,
              opacity: DOLLHOUSE.glassOpacity,
              roughness: 0.05,
              depthWrite: false,
            }),
      ),
    [scope, night],
  );
  /** 自發光材質（依光色與調光；日光模式亮度低、夜間高到會 bloom） */
  const emitCache = useRef(new Map<string, THREE.Material>());
  const emissiveFor = (color: string, dimmer: number) => {
    const key = `${color}|${dimmer}|${night}`;
    let m = emitCache.current.get(key);
    if (!m) {
      const k = dimmer <= 0 ? 0.15 : night ? NIGHT.emissive * (0.25 + 0.75 * dimmer) : 1.1;
      m = scope.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
      emitCache.current.set(key, m);
    }
    return m;
  };
  const emissiveOf = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    if (!e?.light) return emissiveFor('#fff4d6', 1);
    const p = resolveParams(e, o.params);
    return emissiveFor(
      lightColorHex(typeof p.color === 'string' ? p.color : undefined),
      typeof p.dimmer === 'number' ? p.dimmer / 100 : 1,
    );
  };
  const quality = useRef<QualityState>({ orbiting: false, dragging: false });
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
  // 剖面模型：依相機方向決定哪些外牆保持全高，其餘降為剖面高度
  const sides = useMemo(() => (dh ? classifyWalls(structure) : null), [dh, structure]);
  const [fullWalls, setFullWalls] = useState<ReadonlySet<string>>(() => new Set());
  const updateCut = () => {
    if (!sides) return;
    const t = controls.current?.target ?? new THREE.Vector3();
    const dir: [number, number] = [camera.position.x - t.x, camera.position.z - t.z];
    setFullWalls((prev) => {
      const next = fullHeightWalls(sides, dir, prev);
      return sameSet(prev, next) ? prev : next;
    });
  };
  // 牆幾何依（牆, 高度）快取；結構改變時整批釋放
  const wallCache = useMemo(() => new Map<string, THREE.BufferGeometry>(), [structure]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => wallCache.forEach((g) => scope.release(g)), [wallCache, scope]);
  const wallHeight = (w: Wall) => {
    if (!dh || fullWalls.has(w.id)) return structure.height;
    // 夜間（images1）：內牆全高（接收燈光的彩色溢光），靠近相機的外牆只留牆腳
    if (night)
      return sides?.get(w.id)?.exterior ? Math.min(NIGHT.lipHeight, structure.height) : structure.height;
    return Math.min(DOLLHOUSE.cutHeight, structure.height);
  };
  const walls = structure.walls.map((w) => {
    const H = wallHeight(w);
    const k = `${w.id}|${H}`;
    let geom = wallCache.get(k);
    if (!geom) {
      geom = scope.track(buildWallGeometry(structure, w, H));
      wallCache.set(k, geom);
    }
    return { w, geom, cut: H < structure.height };
  });
  const cutWallIds = new Set(walls.filter((x) => x.cut).map((x) => x.w.id));
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
    const opts = dh
      ? { style: viewStyle, bodyColor: mutedColor(`#${slotColor(o).getHexString()}`) }
      : undefined;
    const k = styledVariantKey(variantKey(e, o.catalogId, o.params), opts);
    let g = furnGeoms.current.get(k);
    if (!g) {
      g = scope.track(buildFurnitureGeometry(e, o.params, opts));
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
      if (hiddenFixture(o)) continue;
      const { key, g } = geomFor(o);
      const cur = map.get(key) ?? { g, objs: [] };
      cur.objs.push(o);
      map.set(key, cur);
    }
    return [...map.entries()];
  }, [level.objects, single, layers.furniture, catalog, fullWalls, showCeiling]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 不畫燈體（光仍照射）的物件，避免懸空：
   * - 沒有天花板時的嵌入式天花燈（崁燈、軌道燈）
   * - 掛在「已被剖面降低」牆上的壁掛物（窗簾、壁燈、燈板）
   */
  function hiddenFixture(o: SceneObject) {
    if (!dh) return false;
    const e = catalog.get(o.catalogId);
    const t = e?.model.kind === 'parametric' ? e.model.type : '';
    if (!showCeiling && (t === 'lamp_downlight' || t === 'lamp_track')) return true;
    if (e?.anchor !== 'wall') return false;
    return structure.walls.some((w) => {
      if (wallHeight(w) >= structure.height) return false;
      const L = wallLength(w) || 1;
      const t2 =
        ((o.position[0] - w.a[0]) * (w.b[0] - w.a[0]) + (o.position[2] - w.a[1]) * (w.b[1] - w.a[1])) /
        (L * L);
      if (t2 < -0.05 || t2 > 1.05) return false;
      const px = w.a[0] + (w.b[0] - w.a[0]) * t2;
      const pz = w.a[1] + (w.b[1] - w.a[1]) * t2;
      return Math.hypot(o.position[0] - px, o.position[2] - pz) < w.thickness / 2 + 350;
    });
  }

  function slotColor(o: SceneObject) {
    const e = catalog.get(o.catalogId);
    const slot = e?.materialSlots[0];
    return mats.colorOf(o.materialOverrides?.[slot?.name ?? 'body'] ?? slot?.defaultMaterialId, '#cfc6b8');
  }
  // 剖面模型的顏色已烘進幾何 → instance color 用白色
  const bodyColor = (o: SceneObject) => (dh ? new THREE.Color('#ffffff') : slotColor(o));

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

  // 夜間光源：燈具＋全高外牆上的窗；依畫面焦點挑固定數量
  const cutKey = [...structure.walls.map((w) => (wallHeight(w) < structure.height ? '1' : '0'))].join('');
  const pools = useMemo(() => {
    if (!night) return null;
    const cut = new Set(structure.walls.filter((w) => wallHeight(w) < structure.height).map((w) => w.id));
    const wins = sides
      ? windowLights(structure, sides).filter(
          (l) => !cut.has(structure.openings.find((o) => o.id === l.id)?.wallId ?? ''),
        )
      : [];
    const c = bbox.getCenter(new THREE.Vector3());
    return pickActive([...fixtureLights(level, catalog), ...wins], [c.x, 1200, c.z]);
  }, [night, level, catalog, structure, sides, bbox, cutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const footprint = useMemo(() => {
    if (!night) return null;
    const outer = buildingFootprint(structure, NIGHT.plinth.margin, NIGHT.plinth.radius);
    return { outer, inner: outer.map((f) => offsetPolygon([f], -45)[0] ?? []) };
  }, [night, structure]);

  const size = useThree((s) => s.size);
  const preset = useRef<ViewPreset>('iso-se');
  /** 剖面模型下的人視角：放寬仰角限制（OrbitControls 每次 render 都會套用 props，所以要放 state） */
  const [eyeLevel, setEyeLevel] = useState(false);
  const limited = dh && !eyeLevel;
  /** 剖面模型的相機限制：仰角 20°~70°，fov 22° */
  const dollhouseCamera = () => {
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.fov !== DOLLHOUSE.fovDeg) {
      pc.fov = DOLLHOUSE.fovDeg;
      pc.updateProjectionMatrix();
    }
    if (controls.current) {
      controls.current.minPolarAngle = ((90 - DOLLHOUSE.maxElevationDeg) * Math.PI) / 180;
      controls.current.maxPolarAngle = ((90 - DOLLHOUSE.minElevationDeg) * Math.PI) / 180;
    }
  };
  const viewPreset = (p: ViewPreset) => {
    preset.current = p;
    setEyeLevel(false);
    dollhouseCamera();
    const c = bbox.getCenter(new THREE.Vector3());
    const s = bbox.getSize(new THREE.Vector3());
    const r = Math.max(3000, Math.hypot(s.x, s.z) / 2 + 600);
    const { azimuthDeg, elevationDeg } = VIEW_PRESETS[p];
    const dir = presetDirection(azimuthDeg, elevationDeg);
    const dist = fitDistance(r, DOLLHOUSE.fovDeg, size.width / Math.max(1, size.height));
    camera.position.set(c.x + dir[0] * dist, dir[1] * dist, c.z + dir[2] * dist);
    controls.current?.target.set(c.x, 0, c.z);
    controls.current?.update();
    updateCut();
    invalidate();
  };
  const frameAll = () => {
    if (dh) return viewPreset(preset.current);
    const c = bbox.getCenter(new THREE.Vector3());
    const r = Math.max(4000, bbox.getSize(new THREE.Vector3()).length());
    camera.position.set(c.x + r * 0.55, r * 0.8, c.z + r * 0.75);
    controls.current?.target.set(c.x, 0, c.z);
    controls.current?.update();
    invalidate();
  };
  // 結構改變 → 重新判斷剖面牆
  useEffect(updateCut, [sides]); // eslint-disable-line react-hooks/exhaustive-deps
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
          quality.current.orbiting = true;
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
            updateCut();
            invalidate();
            calls = Math.max(calls, gl.info.render.calls);
            tris = Math.max(tris, gl.info.render.triangles);
            if (now - t0 < ms) requestAnimationFrame(step);
            else {
              quality.current.orbiting = false;
              invalidate();
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
        if (dh) {
          // 人視角需要平視：暫時放寬仰角限制與 fov；選任一視角預設即恢復
          setEyeLevel(true);
          const pc = camera as THREE.PerspectiveCamera;
          pc.fov = 50;
          pc.updateProjectionMatrix();
          if (controls.current) {
            controls.current.minPolarAngle = 0;
            controls.current.maxPolarAngle = Math.PI * 0.495;
          }
        }
        const c = bbox.getCenter(new THREE.Vector3());
        camera.position.set(bbox.min.x + 600, 1600, c.z);
        controls.current?.target.set(c.x, 1400, c.z);
        controls.current?.update();
        invalidate();
      },
      frameAll,
      viewPreset,
      gbuffer: (o) =>
        renderGBuffer(
          gl,
          scene3,
          camera as THREE.PerspectiveCamera,
          controls.current?.target.clone() ?? new THREE.Vector3(),
          o,
        ),
      style: () => (dh ? 'dollhouse' : 'simple'),
      lighting: () => (night ? 'night' : 'day'),
      lights: () => ({
        total: night ? fixtureLights(level, catalog).length : 0,
        point: pools?.point.length ?? 0,
        spot: pools?.spot.length ?? 0,
        area: pools?.area.length ?? 0,
        shadows: pools ? [...pools.point, ...pools.spot].filter((l) => l.castShadow).length : 0,
        windows: pools?.area.filter((l) => l.source === 'window').length ?? 0,
      }),
      cutWalls: () => [...cutWallIds].sort(),
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

  const shadow = dh ? { castShadow: true, receiveShadow: true } : {};
  return (
    <>
      {dh ? (
        <>
          <DollhouseStage bbox={bbox} mats={mats} quality={quality} lighting={night ? 'night' : 'day'} />
          {pools && <FixtureLights pools={pools} />}
          {footprint && <Plinth footprint={footprint.outer} inner={footprint.inner} />}
        </>
      ) : (
        <>
          <color attach="background" args={[theme.bg]} />
          <hemisphereLight args={['#ffffff', '#b9b2a6', 1.6]} />
          <directionalLight position={[8000, 12000, 6000]} intensity={1.4} />
        </>
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping={false}
        maxPolarAngle={limited ? ((90 - DOLLHOUSE.minElevationDeg) * Math.PI) / 180 : Math.PI * 0.495}
        minPolarAngle={limited ? ((90 - DOLLHOUSE.maxElevationDeg) * Math.PI) / 180 : 0}
        onStart={() => (quality.current.orbiting = true)}
        onEnd={() => {
          quality.current.orbiting = false;
          invalidate();
        }}
        onChange={dh ? updateCut : undefined}
      />
      {layers.structure &&
        walls.map(({ w, geom }) => (
          <mesh
            key={w.id}
            {...shadow}
            geometry={geom}
            material={[
              mats.get(w.materialId, '#efece6'),
              mats.get(w.materialIdB ?? w.materialId, '#efece6'),
              selSet.has(w.id) ? selMat : capMat,
            ]}
            onClick={select(w.id)}
            userData={{ id: w.id, gkind: 'wall' }}
          />
        ))}
      {layers.structure &&
        rooms.map((r) => {
          const room = level.rooms.find((x) => x.id === r.roomId);
          return (
            <group key={r.key}>
              <mesh
                geometry={r.floor}
                material={
                  dh
                    ? mats.get(dollhouseFloorMaterial(room, DEFAULTS.floorMaterialId), '#d8d2c6')
                    : mats.get(room?.floorMaterialId, '#d8d2c6')
                }
                receiveShadow={dh}
                onClick={select(r.roomId)}
                userData={{ id: r.roomId, gkind: 'floor' }}
              />
              {showCeiling && (
                <mesh
                  userData={{ gkind: 'ceiling', id: r.roomId }}
                  geometry={r.ceiling}
                  material={mats.get(room?.ceilingMaterialId ?? 'mat_ceiling_white', '#fafaf7')}
                />
              )}
            </group>
          );
        })}
      {layers.structure &&
        fills
          // 剖面牆上的門窗扇會突出矮牆 → 不畫，只留開口
          .filter((f) => !cutWallIds.has(f.o.wallId))
          .map((f) => (
            <mesh
              key={f.o.id}
              userData={{ gkind: 'opening', id: f.o.id }}
              castShadow={dh}
              geometry={f.geom}
              material={
                dh ? [selSet.has(f.o.id) ? selMat : vcMat, glassMat] : selSet.has(f.o.id) ? selMat : vcMat
              }
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
          material={dh ? [vcMat, emissiveOf(grp.objs[0]!)] : vcMat}
          colorOf={bodyColor}
          selected={selSet}
          highlight={theme.primary}
          shadows={dh}
          onPick={(id, additive) => store.getState().select([id], additive)}
        />
      ))}
      {single && layers.furniture && (
        <SelectedObject
          key={single.id}
          obj={single}
          geom={geomFor(single).g}
          material={selMat}
          emissive={dh ? emissiveOf(single) : undefined}
          color={bodyColor(single)}
          level={level}
          mode={transformMode}
          uniform={uniformScale}
          catalog={catalog}
          shadows={dh}
          onDragging={(v) => (quality.current.dragging = v)}
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
  shadows,
  onPick,
}: {
  geom: THREE.BufferGeometry;
  objs: SceneObject[];
  material: THREE.Material | THREE.Material[];
  colorOf: (o: SceneObject) => THREE.Color;
  selected: Set<string>;
  highlight: string;
  shadows?: boolean;
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
      args={[geom, material as THREE.Material, objs.length]}
      userData={{ gkind: 'object', ids: objs.map((o) => o.id) }}
      castShadow={shadows}
      receiveShadow={shadows}
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
  emissive,
  color,
  level,
  mode,
  uniform,
  catalog,
  shadows,
  onDragging,
  onCommit,
}: {
  obj: SceneObject;
  geom: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  emissive?: THREE.Material;
  color: THREE.Color;
  level: Level;
  mode: Viewer3DProps['transformMode'];
  uniform: boolean;
  catalog: Catalog;
  shadows?: boolean;
  onDragging?: (v: boolean) => void;
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
        <mesh
          geometry={geom}
          material={emissive ? [mat, emissive] : mat}
          castShadow={shadows}
          receiveShadow={shadows}
          userData={{ gkind: 'object', id: obj.id }}
        />
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
          onMouseDown={() => onDragging?.(true)}
          onMouseUp={() => {
            onDragging?.(false);
            commit();
          }}
        />
      )}
    </>
  );
}
