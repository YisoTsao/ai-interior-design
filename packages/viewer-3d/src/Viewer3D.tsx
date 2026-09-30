import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { useStore } from 'zustand';
import { DEFAULTS, activeLevel, setMaterial, transformObject, type EditorStore } from '@interiorai/app-state';
import { materialMap, objectDims, type Catalog, type CatalogEntry, type Material } from '@interiorai/catalog';
import {
  buildingFootprint,
  detectRooms,
  offsetPolygon,
  pointOnWall,
  snapToWall,
  wallLength,
} from '@interiorai/core-geometry';
import type { Appearance, Level, SceneObject, Wall } from '@interiorai/scene-schema';
import { viewer3dApi } from './api.js';
import { renderPanorama } from './panorama.js';
import { renderGBuffer } from './gbuffer.js';
import { DollhouseStage, type QualityState } from './DollhouseStage.js';
import { LightBeams, LightGizmo } from './effects.js';
import { buildFurnitureGeometry, buildOpeningFill, styledVariantKey, variantKey } from './furniture.js';
import {
  DEFAULT_SKY,
  NIGHT_SKY,
  effectiveLight,
  fixtureLights,
  indirectEstimate,
  pickActive,
  windowLights,
  type LightingMode,
} from './lighting.js';
import { instantiateModel, useModel } from './models.js';
import { WalkControls } from './walk.js';
import { FixtureLights, Plinth } from './NightScene.js';
import { MaterialCache, ResourceScope } from './resources.js';
import {
  DEFAULT_GRAPHICS,
  DOLLHOUSE,
  NIGHT,
  QUALITY_BUDGET,
  STYLE_MATERIALS,
  VIEW_PRESETS,
  classifyWalls,
  dollhouseFloorMaterial,
  fitDistance,
  fullHeightWalls,
  mutedColor,
  presetDirection,
  sameSet,
  type GraphicsSettings,
  type ViewPreset,
  type ViewStyle,
} from './style.js';
import { buildBaseboard, buildRoomSurfaces, buildWallGeometry } from './walls3d.js';

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
  /** 畫質（使用者偏好）；畫質等級改變時重建 Canvas */
  graphics?: GraphicsSettings;
  /** 資產目錄版本（使用者上傳模型後遞增，觸發重新分組） */
  catalogVersion?: number;
  /** 右鍵選單（hit＝點到的實體 id；world＝地面座標 x,z） */
  onContextMenu?: (e: {
    clientX: number;
    clientY: number;
    hit: string | null;
    world: [number, number] | null;
  }) => void;
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
  const quality = (props.graphics ?? DEFAULT_GRAPHICS).quality;
  return (
    <div
      className="h-full w-full"
      data-testid="viewer3d"
      data-style={dh ? 'dollhouse' : 'simple'}
      data-lighting={dh ? (night ? 'night' : 'day') : 'none'}
      onContextMenu={(e) => e.preventDefault()}
      style={{ background: night ? NIGHT.background.edge : dh ? '#ddd5ca' : props.theme.bg }}
    >
      <Canvas
        key={`${ctxKey}-${dh ? 'dh' : 'simple'}-${night ? 'night' : 'day'}-${quality}`}
        frameloop="demand"
        dpr={QUALITY_BUDGET[quality].dpr}
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
          if (e.type === 'contextmenu') {
            const w = viewer3dApi.get()?.clientToFloor(e.clientX, e.clientY) ?? null;
            props.onContextMenu?.({ clientX: e.clientX, clientY: e.clientY, hit: null, world: w });
          } else if (e.button === 0) props.store.getState().select([]);
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
  graphics = DEFAULT_GRAPHICS,
  catalogVersion = 0,
  onContextMenu,
}: Viewer3DProps) {
  const dh = viewStyle === 'dollhouse';
  const night = dh && lighting === 'night';
  const scene = useStore(store, (s) => s.scene);
  const levelId = useStore(store, (s) => s.levelId);
  const selection = useStore(store, (s) => s.selection);
  const tool = useStore(store, (s) => s.tool);
  const paintId = useStore(store, (s) => s.placeCatalogId);
  const snapOn = useStore(store, (s) => s.snapEnabled);
  /** 第一人稱漫遊（FE-V3D-01） */
  const [walking, setWalking] = useState(false);
  const layers = useStore(store, (s) => s.layers);
  const level = useMemo(() => activeLevel({ scene, levelId }), [scene, levelId]);
  const env = scene.environment;
  const gl = useThree((s) => s.gl);
  const scene3 = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitImpl>(null);
  const budget = QUALITY_BUDGET[graphics.quality];
  /** 夜間：光度 → 顯示值（曝光 EV 作用在物理光源上） */
  const k = NIGHT.photometricScale * 2 ** (env?.exposureEv ?? 0);
  const sky = NIGHT_SKY[env?.sky ?? DEFAULT_SKY];

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
  const baseboardMat = useMemo(
    () => scope.track(new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.55 })),
    [scope],
  );
  const glassMat = useMemo(
    () =>
      scope.track(
        night
          ? // 夜間（ADR-023）：窗外是夜空——深色反光玻璃，只帶天空亮度的微光（物理量 × 曝光），不再是明亮光板
            new THREE.MeshStandardMaterial({
              color: '#0b0e14',
              roughness: 0.04,
              metalness: 0.1,
              emissive: new THREE.Color(sky.color),
              emissiveIntensity: sky.luminance * k,
            })
          : new THREE.MeshStandardMaterial({
              color: DOLLHOUSE.glassColor,
              transparent: true,
              opacity: DOLLHOUSE.glassOpacity,
              roughness: 0.05,
              depthWrite: false,
            }),
      ),
    [scope, night, sky, k],
  );
  /** 自發光材質（依光色與亮度；日光模式亮度低、夜間高到會 bloom） */
  const emitCache = useRef(new Map<string, THREE.Material>());
  const emissiveFor = (color: string, ratio: number) => {
    const key = `${color}|${ratio.toFixed(3)}|${night}|${k}`;
    let m = emitCache.current.get(key);
    if (!m) {
      const on = ratio > 0;
      const e = !on
        ? 0.15
        : night
          ? NIGHT.emissive * (0.25 + 0.75 * Math.min(3, ratio)) * (k / NIGHT.photometricScale)
          : 1.1;
      m = scope.track(
        new THREE.MeshBasicMaterial({ color: new THREE.Color(on ? color : '#8a8378').multiplyScalar(e) }),
      );
      emitCache.current.set(key, m);
    }
    return m;
  };
  const emissiveOf = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    if (!e?.light) return emissiveFor('#fff4d6', 1);
    const eff = effectiveLight(o, e);
    return eff ? emissiveFor(eff.color, eff.ratio) : emissiveFor('#000000', 0);
  };
  const quality = useRef<QualityState>({ orbiting: false, dragging: false });
  /** 家具頂點色材質：依材質槽的粗糙度／金屬度與外觀覆寫分組快取 */
  const furnMats = useRef(new Map<string, THREE.MeshStandardMaterial>());
  const furnSurface = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    const slot = e?.materialSlots[0];
    const s = mats.surface(o.materialOverrides?.[slot?.name ?? 'body'] ?? slot?.defaultMaterialId);
    const a = o.appearance;
    return {
      roughness: a?.roughness ?? s.roughness,
      metalness: a?.metalness ?? s.metalness,
      opacity: a?.opacity ?? 1,
    };
  };
  const furnMat = (o: SceneObject) => {
    const s = furnSurface(o);
    const key = `${s.roughness}|${s.metalness}|${s.opacity}`;
    let m = furnMats.current.get(key);
    if (!m) {
      m = scope.track(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: s.roughness,
          metalness: s.metalness,
          transparent: s.opacity < 1,
          opacity: s.opacity,
          depthWrite: s.opacity >= 1,
        }),
      );
      furnMats.current.set(key, m);
    }
    return { key, m };
  };
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
  const sides = useMemo(() => classifyWalls(structure), [structure]);
  const [fullWalls, setFullWalls] = useState<ReadonlySet<string>>(() => new Set());
  const updateCut = () => {
    if (!dh) return;
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
  /** 牆本身的高度（個別牆高覆寫，ADR-023） */
  const ownHeight = (w: Wall) => Math.min(w.height ?? structure.height, structure.height);
  const wallHeight = (w: Wall) => {
    const own = ownHeight(w);
    if (!dh || walking || fullWalls.has(w.id)) return own;
    // 夜間（images1）：內牆全高（接收燈光的彩色溢光），靠近相機的外牆只留牆腳
    if (night) return sides.get(w.id)?.exterior ? Math.min(NIGHT.lipHeight, own) : own;
    return Math.min(DOLLHOUSE.cutHeight, own);
  };
  const walls = structure.walls
    .filter((w) => !w.appearance?.hidden)
    .map((w) => {
      const H = wallHeight(w);
      const k2 = `${w.id}|${H}`;
      let geom = wallCache.get(k2);
      if (!geom) {
        geom = scope.track(buildWallGeometry(structure, w, H));
        wallCache.set(k2, geom);
      }
      return { w, geom, cut: H < ownHeight(w) };
    });
  const cutWallIds = new Set(walls.filter((x) => x.cut).map((x) => x.w.id));
  // 踢腳板：只加在朝房間的一側；剖面牆高度低於踢腳板時不畫
  const baseboards = useMemo(() => {
    const out: { id: string; g: THREE.BufferGeometry }[] = [];
    for (const w of structure.walls) {
      if (!w.baseboard || w.appearance?.hidden) continue;
      const side = sides.get(w.id);
      let which: 'A' | 'B' | 'both' = 'both';
      if (side?.exterior && side.outward) {
        const L = wallLength(w) || 1;
        const nA: [number, number] = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
        which = nA[0] * side.outward[0] + nA[1] * side.outward[1] > 0 ? 'B' : 'A';
      }
      const g = buildBaseboard(structure, w, w.baseboard, which);
      if (g) out.push({ id: w.id, g: scope.track(g) });
    }
    return out;
  }, [structure, sides, scope]);
  useEffect(() => () => baseboards.forEach((b) => scope.release(b.g)), [baseboards, scope]);
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
  /** 波打線（FE-FIN-01）：地板外圈的收邊帶，放在鋪貼上方 1 mm */
  const borders = useMemo(() => {
    const out: { id: string; g: THREE.BufferGeometry; mat: string | undefined }[] = [];
    const det = detectRooms(structure).rooms;
    for (const r of structure.rooms) {
      const bw = r.floorTiling?.borderWidth;
      if (!bw) continue;
      const d = det.find((x) => x.key === [...r.wallIds].sort().join('|'));
      if (!d || d.floor.length < 3) continue;
      const inner = offsetPolygon([d.floor], -bw)[0];
      if (!inner || inner.length < 3) continue;
      const shape = new THREE.Shape(d.floor.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z))));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 1, 0);
      out.push({ id: r.id, g: scope.track(g), mat: r.floorTiling?.borderMaterialId });
    }
    return out;
  }, [structure, scope]);
  useEffect(() => () => borders.forEach((b) => scope.release(b.g)), [borders, scope]);
  const fills = useMemo(
    () =>
      level.openings.flatMap((o) => {
        const w = level.walls.find((x) => x.id === o.wallId);
        const g = w
          ? buildOpeningFill(o.type, o.width, o.height, Math.min(w.thickness, 80), o.style, o.openAngle ?? 0)
          : null;
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
  /** 門窗外觀覆寫：框／門扇換色、玻璃透明度 */
  const openingMats = useRef(new Map<string, THREE.Material>());
  const openingMaterial = (
    a: Appearance | undefined,
    selected: boolean,
  ): THREE.Material | THREE.Material[] => {
    const frame = selected
      ? selMat
      : a?.color || a?.roughness !== undefined
        ? (() => {
            const key = `f|${a.color}|${a.roughness}`;
            let m = openingMats.current.get(key);
            if (!m) {
              m = scope.track(
                new THREE.MeshStandardMaterial({
                  color: a.color ?? '#b89a78',
                  roughness: a.roughness ?? 0.7,
                }),
              );
              openingMats.current.set(key, m);
            }
            return m;
          })()
        : vcMat;
    if (!dh) return frame;
    let glass: THREE.Material = glassMat;
    if (a?.opacity !== undefined && !night) {
      const key = `g|${a.opacity}`;
      glass = openingMats.current.get(key) ?? scope.track(glassMat.clone());
      (glass as THREE.MeshStandardMaterial).opacity = a.opacity;
      openingMats.current.set(key, glass);
    }
    return [frame, glass];
  };
  const vcMat = useMemo(
    () => scope.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })),
    [scope],
  );

  // 家具幾何快取（變體鍵）
  const furnGeoms = useRef(new Map<string, THREE.BufferGeometry>());
  const geomFor = (o: SceneObject) => {
    const e = catalog.get(o.catalogId);
    // 使用者明確指定的顏色直接使用；材質色在剖面模型中轉為莫蘭迪色調
    const opts = dh
      ? {
          style: viewStyle,
          bodyColor: o.appearance?.color ?? mutedColor(`#${slotColor(o).getHexString()}`),
        }
      : undefined;
    const key = styledVariantKey(variantKey(e, o.catalogId, o.params), opts);
    let g = furnGeoms.current.get(key);
    if (!g) {
      g = scope.track(buildFurnitureGeometry(e, o.params, opts));
      furnGeoms.current.set(key, g);
    }
    return { key, g };
  };
  useEffect(() => {
    const m = furnGeoms.current;
    return () => m.clear();
  }, [scope]);

  const isGlb = (o: SceneObject) => catalog.get(o.catalogId)?.model.kind === 'glb';
  const single = selection.length === 1 ? level.objects.find((o) => o.id === selection[0]) : undefined;
  const selSet = useMemo(() => new Set(selection), [selection]);
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { g: THREE.BufferGeometry; m: THREE.Material; objs: SceneObject[]; shadow: boolean }
    >();
    if (!layers.furniture) return [];
    for (const o of level.objects) {
      if (single && o.id === single.id) continue;
      if (o.appearance?.hidden || isGlb(o) || hiddenFixture(o)) continue;
      const { key, g } = geomFor(o);
      const fm = furnMat(o);
      const shadow = o.appearance?.castShadow ?? true;
      const gk = `${key}|${fm.key}|${shadow}`;
      const cur = map.get(gk) ?? { g, m: fm.m, objs: [], shadow };
      cur.objs.push(o);
      map.set(gk, cur);
    }
    return [...map.entries()];
  }, [level.objects, single, layers.furniture, catalog, catalogVersion, fullWalls, showCeiling, mats]); // eslint-disable-line react-hooks/exhaustive-deps
  const glbObjs = layers.furniture
    ? level.objects.filter((o) => isGlb(o) && !o.appearance?.hidden && !(single && o.id === single.id))
    : [];

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
      if (wallHeight(w) >= ownHeight(w) && wallHeight(w) >= o.position[1]) return false;
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
  // 剖面模型的顏色已烘進幾何 → instance color 用白色；簡易模式以外觀覆寫色優先
  const bodyColor = (o: SceneObject) =>
    dh
      ? new THREE.Color('#ffffff')
      : o.appearance?.color
        ? new THREE.Color(o.appearance.color)
        : slotColor(o);

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
  const cutKey = [...structure.walls.map((w) => (wallHeight(w) < ownHeight(w) ? '1' : '0'))].join('');
  // catalogVersion：上傳模型後目錄內容改變（catalog 參照不變）
  const allFixtures = useMemo(
    () => (night ? fixtureLights(level, catalog) : []),
    [night, level, catalog, catalogVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wins = useMemo(() => {
    if (!night) return [];
    const cut = new Set(structure.walls.filter((w) => wallHeight(w) < ownHeight(w)).map((w) => w.id));
    return windowLights(structure, sides, env?.sky ?? DEFAULT_SKY).filter(
      (l) => !cut.has(structure.openings.find((o) => o.id === l.id)?.wallId ?? ''),
    );
  }, [night, structure, sides, cutKey, env?.sky]); // eslint-disable-line react-hooks/exhaustive-deps
  const pools = useMemo(() => {
    if (!night) return null;
    const c = bbox.getCenter(new THREE.Vector3());
    return pickActive([...allFixtures, ...wins], [c.x, 1200, c.z]);
  }, [night, allFixtures, wins, bbox]);
  /**
   * 間接光（ADR-023）：所有燈具（含未進光源池者）與窗的光通量 → 積分球公式估計平均照度。
   * 反射面：地板（依材質明度）、實際畫出的牆面（外牆只算室內側）；天花（未顯示時）與被剖掉的牆面視為逸散。
   * 半球光的「天」色照亮朝上的面（地板），開頂時地板上方沒有天花反射 → 減弱；「地」色照亮朝下的面，來自地板反射。
   */
  const ambient = useMemo(() => {
    if (!night) return undefined;
    const floorM2 = detectRooms(structure).rooms.reduce((a, r) => a + r.netArea, 0) / 1e6;
    let wallLit = 0;
    let wallLost = 0;
    for (const w of structure.walls) {
      const L = wallLength(w) / 1000;
      const sidesN = sides.get(w.id)?.exterior ? 1 : 2;
      const shown = wallHeight(w) / 1000;
      wallLit += L * shown * sidesN;
      wallLost += L * Math.max(0, ownHeight(w) / 1000 - shown) * sidesN;
    }
    const floorRho = 0.2;
    const est = indirectEstimate(
      [...allFixtures, ...wins],
      [
        { areaM2: floorM2, reflectance: floorRho },
        { areaM2: floorM2, reflectance: showCeiling ? 0.8 : 0 },
        { areaM2: wallLit, reflectance: 0.7 },
        { areaM2: wallLost, reflectance: 0 },
      ],
    );
    const c = new THREE.Color(est.color);
    const sky = c.clone().multiplyScalar(showCeiling ? 1 : 0.55);
    const ground = c.clone().multiply(new THREE.Color('#b08a62')).multiplyScalar(0.8);
    return {
      color: `#${sky.getHexString()}`,
      ground: `#${ground.getHexString()}`,
      intensity: Math.max(0.01, est.lux * k),
    };
  }, [night, structure, sides, allFixtures, wins, showCeiling, k, cutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const footprint = useMemo(() => {
    if (!night) return null;
    const outer = buildingFootprint(structure, NIGHT.plinth.margin, NIGHT.plinth.radius);
    return { outer, inner: outer.map((f) => offsetPolygon([f], -45)[0] ?? []) };
  }, [night, structure]);
  /** 選取燈具的光源示意（兩種風格、日夜都顯示） */
  const selectedLight = useMemo(
    () => (single ? fixtureLights({ objects: [single] }, catalog)[0] : undefined),
    [single, catalog],
  );

  // 遊戲式選取外框：選取中（非 instanced）的 mesh
  const outline = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    const out: THREE.Object3D[] = [];
    if (selSet.size)
      scene3.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && selSet.has(o.userData.id as string))
          out.push(o);
      });
    outline.current = out;
    invalidate();
  });
  const capture = useRef<(() => string) | null>(null);

  const size = useThree((s) => s.size);
  const preset = useRef<ViewPreset>('iso-se');
  /** 剖面模型下的人視角：放寬仰角限制（OrbitControls 每次 render 都會套用 props，所以要放 state） */
  const [eyeLevel, setEyeLevel] = useState(false);
  const limited = dh && !eyeLevel && !walking;
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
        total: allFixtures.length,
        point: pools?.point.length ?? 0,
        spot: pools?.spot.length ?? 0,
        area: pools?.area.length ?? 0,
        shadows: pools ? [...pools.point, ...pools.spot].filter((l) => l.castShadow).length : 0,
        windows: pools?.area.filter((l) => l.source === 'window').length ?? 0,
        windowLuminance: night ? sky.luminance : 0,
        ambient: ambient?.intensity ?? 0,
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
      screenshot: () => {
        if (capture.current) return capture.current();
        gl.render(scene3, camera);
        return gl.domElement.toDataURL('image/png');
      },
      panorama: (o) => {
        const t = controls.current?.target ?? new THREE.Vector3();
        // 漫遊／人視角：以相機位置；俯瞰：在目標點的人眼高度（1.6 m）
        const eye =
          walking || camera.position.y < 2200 ? camera.position.clone() : new THREE.Vector3(t.x, 1600, t.z);
        const url = renderPanorama(gl, scene3, eye, o);
        invalidate();
        return url;
      },
      clientToFloor: (x, y) => floorHit(x, y, 0),
      pickSurface: (x, y) => {
        const r = gl.domElement.getBoundingClientRect();
        raycaster.setFromCamera(
          new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1),
          camera,
        );
        const targets: THREE.Object3D[] = [];
        scene3.traverse((o) => {
          const k = o.userData.gkind as string | undefined;
          if ((o as THREE.Mesh).isMesh && o.visible && k && k !== 'board') targets.push(o);
        });
        for (const hit of raycaster.intersectObjects(targets, false)) {
          const u = hit.object.userData as { gkind: string; id?: string; ids?: string[] };
          const id = u.ids && hit.instanceId !== undefined ? u.ids[hit.instanceId] : u.id;
          if (!id) continue;
          return { kind: u.gkind, id, side: hit.face?.materialIndex === 1 ? 'B' : 'A' };
        }
        return null;
      },
      setCamera: (c) => {
        setEyeLevel(true);
        const pc = camera as THREE.PerspectiveCamera;
        pc.fov = c.fovDeg;
        pc.updateProjectionMatrix();
        if (controls.current) {
          controls.current.minPolarAngle = 0;
          controls.current.maxPolarAngle = Math.PI * 0.495;
        }
        camera.position.set(...c.position);
        controls.current?.target.set(...c.target);
        controls.current?.update();
        updateCut();
        invalidate();
      },
      walk: (on) => setWalking(on),
      isWalking: () => walking,
    });
    return () => viewer3dApi.set(null);
  });

  /** 游標射線與水平面 y 的交點（世界 x,z） */
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const floorHit = (clientX: number, clientY: number, y: number): [number, number] | null => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
      new THREE.Vector3(),
    );
    return hit ? [Math.round(hit.x), Math.round(hit.z)] : null;
  };

  /**
   * 點擊表面：選取；油漆模式（FE-V3D-05）套用材質、Alt＋點擊＝滴管（吸取該面的材質）。
   * 牆的 A/B 面由命中的幾何群組（materialIndex 0＝A、1＝B）決定。
   */
  const surface =
    (kind: 'wall' | 'floor' | 'ceiling' | 'object' | 'opening', id: string | undefined) =>
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (!id) return;
      if (tool === 'paint') {
        const side: 'A' | 'B' = e.face?.materialIndex === 1 ? 'B' : 'A';
        if (e.nativeEvent.altKey) {
          const mat = materialAt(kind, id, side);
          if (mat) store.getState().setTool('paint', mat);
          return;
        }
        if (!paintId) return;
        const exec = store.getState().exec;
        if (kind === 'wall') exec(setMaterial(level.id, { kind: 'wall', id, side }, paintId));
        else if (kind === 'floor') exec(setMaterial(level.id, { kind: 'floor', roomId: id }, paintId));
        else if (kind === 'ceiling') exec(setMaterial(level.id, { kind: 'ceiling', roomId: id }, paintId));
        else if (kind === 'object') {
          const o = level.objects.find((x) => x.id === id);
          const slot = o && catalog.get(o.catalogId)?.materialSlots[0]?.name;
          if (slot) exec(setMaterial(level.id, { kind: 'object', id, slot }, paintId));
        }
        return;
      }
      store.getState().select([id], e.nativeEvent.shiftKey);
    };
  const materialAt = (kind: string, id: string, side: 'A' | 'B'): string | undefined => {
    if (kind === 'wall') {
      const w = level.walls.find((x) => x.id === id);
      return side === 'B' ? (w?.materialIdB ?? w?.materialId) : w?.materialId;
    }
    const r = level.rooms.find((x) => x.id === id);
    if (kind === 'floor') return r?.floorMaterialId;
    if (kind === 'ceiling') return r?.ceilingMaterialId ?? 'mat_ceiling_white';
    const o = level.objects.find((x) => x.id === id);
    const slot = o && catalog.get(o.catalogId)?.materialSlots[0];
    return slot ? (o.materialOverrides?.[slot.name] ?? slot.defaultMaterialId) : undefined;
  };
  const select = (id: string | undefined) => surface('opening', id);
  const ctx = (id: string | undefined) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    if (id && !store.getState().selection.includes(id)) store.getState().select([id]);
    onContextMenu?.({
      clientX: e.nativeEvent.clientX,
      clientY: e.nativeEvent.clientY,
      hit: id ?? null,
      world: [Math.round(e.point.x), Math.round(e.point.z)],
    });
  };

  /** 沿地面拖曳家具（FE-V3D-03）：不需 gizmo；靠牆 20 cm 內自動貼齊並背靠牆 */
  const [dragPos, setDragPos] = useState<{ id: string; pos: [number, number, number]; rot: number } | null>(
    null,
  );
  const startDrag = (o: SceneObject, e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'select' || o.locked || e.nativeEvent.button !== 0 || walking || e.nativeEvent.shiftKey)
      return;
    e.stopPropagation();
    const p = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY, o.position[1]);
    if (!p) return;
    if (!store.getState().selection.includes(o.id)) store.getState().select([o.id]);
    const entry = catalog.get(o.catalogId);
    const depth = entry ? objectDims(entry, o.params, o.scale).d : 500;
    const off: [number, number] = [o.position[0] - p[0], o.position[2] - p[1]];
    const sx = e.nativeEvent.clientX;
    const sy = e.nativeEvent.clientY;
    let moved = false;
    let last: { pos: [number, number, number]; rot: number } | null = null;
    if (controls.current) controls.current.enabled = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      quality.current.dragging = true;
      const q = floorHit(ev.clientX, ev.clientY, o.position[1]);
      if (!q) return;
      let x = Math.round(q[0] + off[0]);
      let z = Math.round(q[1] + off[1]);
      let rot = o.rotationY;
      if (snapOn && !ev.altKey && entry?.anchor !== 'ceiling') {
        const sn = snapToWall(level, [x, z], depth, 200);
        if (sn) [x, z, rot] = [sn.pos[0], sn.pos[1], sn.rotationY];
        else [x, z] = [Math.round(x / 10) * 10, Math.round(z / 10) * 10];
      }
      last = { pos: [x, o.position[1], z], rot };
      setDragPos({ id: o.id, ...last });
      invalidate();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (controls.current) controls.current.enabled = true;
      quality.current.dragging = false;
      if (moved && last)
        store.getState().exec(transformObject(level.id, o.id, { position: last.pos, rotationY: last.rot }));
      setDragPos(null);
      invalidate();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const shadow = dh ? { castShadow: true, receiveShadow: true } : {};
  const commitTransform = (id: string) => (t: Parameters<typeof transformObject>[2]) =>
    store.getState().exec(transformObject(level.id, id, t));
  const singleEntry = single ? catalog.get(single.catalogId) : undefined;
  return (
    <>
      {dh ? (
        <>
          <DollhouseStage
            bbox={bbox}
            mats={mats}
            quality={quality}
            lighting={night ? 'night' : 'day'}
            env={env}
            graphics={graphics}
            ambient={ambient}
            outline={outline}
            outlineColor={night ? '#ffd166' : theme.primary}
            capture={capture}
          />
          {pools && (
            <FixtureLights
              pools={pools}
              scale={k}
              shadowSize={{ spot: budget.spotShadow, point: budget.pointShadow }}
            />
          )}
          {pools && graphics.beams && <LightBeams spots={pools.spot} scale={k} />}
          {footprint && <Plinth footprint={footprint.outer} inner={footprint.inner} />}
        </>
      ) : (
        <>
          <color attach="background" args={[theme.bg]} />
          <hemisphereLight args={['#ffffff', '#b9b2a6', 1.6 * (env?.ambient ?? 1)]} />
          <directionalLight position={[8000, 12000, 6000]} intensity={1.4} />
        </>
      )}
      {walking && <WalkControls level={level} onExit={() => setWalking(false)} />}
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!walking}
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
            castShadow={dh && (w.appearance?.castShadow ?? true)}
            receiveShadow={dh}
            geometry={geom}
            material={[
              mats.tiled(w.materialId, '#efece6', w.appearance, w.tilingA),
              mats.tiled(w.materialIdB ?? w.materialId, '#efece6', w.appearanceB ?? w.appearance, w.tilingB),
              selSet.has(w.id) ? selMat : capMat,
            ]}
            onClick={surface('wall', w.id)}
            onContextMenu={ctx(w.id)}
            userData={{ id: w.id, gkind: 'wall' }}
          />
        ))}
      {layers.structure &&
        baseboards.map((b) => (
          <mesh
            key={`bb-${b.id}`}
            {...shadow}
            geometry={b.g}
            material={baseboardMat}
            onClick={select(b.id)}
            userData={{ id: b.id, gkind: 'wall' }}
          />
        ))}
      {layers.structure &&
        rooms.map((r) => {
          const room = level.rooms.find((x) => x.id === r.roomId);
          return (
            <group key={r.key}>
              <mesh
                geometry={r.floor}
                material={mats.tiled(
                  dh ? dollhouseFloorMaterial(room, DEFAULTS.floorMaterialId) : room?.floorMaterialId,
                  '#d8d2c6',
                  room?.floorAppearance,
                  room?.floorTiling,
                )}
                receiveShadow={dh}
                onClick={surface('floor', r.roomId)}
                onContextMenu={ctx(r.roomId)}
                userData={{ id: r.roomId, gkind: 'floor' }}
              />
              {showCeiling && (
                <mesh
                  userData={{ gkind: 'ceiling', id: r.roomId }}
                  onClick={surface('ceiling', r.roomId)}
                  geometry={r.ceiling}
                  material={mats.styled(
                    room?.ceilingMaterialId ?? 'mat_ceiling_white',
                    '#fafaf7',
                    room?.ceilingAppearance,
                  )}
                />
              )}
            </group>
          );
        })}
      {layers.structure &&
        borders.map((b) => (
          <mesh
            key={`border-${b.id}`}
            geometry={b.g}
            material={mats.get(b.mat ?? 'mat_stone_marble', '#d5d0c6')}
            receiveShadow={dh}
            onClick={surface('floor', b.id)}
            userData={{ id: b.id, gkind: 'floor' }}
          />
        ))}
      {layers.structure &&
        fills
          // 剖面牆上的門窗扇會突出矮牆 → 不畫，只留開口
          .filter((f) => !cutWallIds.has(f.o.wallId) && !f.o.appearance?.hidden)
          .map((f) => (
            <mesh
              key={f.o.id}
              userData={{ gkind: 'opening', id: f.o.id }}
              castShadow={dh && (f.o.appearance?.castShadow ?? true)}
              geometry={f.geom}
              material={openingMaterial(f.o.appearance, selSet.has(f.o.id))}
              position={f.pos as unknown as [number, number, number]}
              rotation={[0, f.rotY, 0]}
              onClick={select(f.o.id)}
              onContextMenu={ctx(f.o.id)}
            />
          ))}
      {groups.map(([key, grp]) => (
        <FurnitureInstances
          key={key}
          geom={grp.g}
          objs={grp.objs}
          material={dh ? [grp.m, emissiveOf(grp.objs[0]!)] : grp.m}
          colorOf={bodyColor}
          selected={selSet}
          highlight={theme.primary}
          shadows={dh && grp.shadow}
          onPick={(o, e) => surface('object', o.id)(e)}
          onDown={startDrag}
          onMenu={(o, e) => ctx(o.id)(e)}
        />
      ))}
      {glbObjs.map((o) => (
        <group
          key={o.id}
          position={[o.position[0], o.position[1], o.position[2]]}
          rotation={[0, o.rotationY, 0]}
          scale={(o.scale ?? [1, 1, 1]) as [number, number, number]}
          onClick={surface('object', o.id)}
          onContextMenu={ctx(o.id)}
          onPointerDown={(e) => startDrag(o, e)}
        >
          <GlbModel obj={o} entry={catalog.get(o.catalogId)!} shadows={dh} />
        </group>
      ))}
      {single && layers.furniture && !single.appearance?.hidden && (
        <SelectedObject
          key={single.id}
          obj={single}
          level={level}
          mode={transformMode}
          uniform={uniformScale}
          catalog={catalog}
          onDragging={(v) => (quality.current.dragging = v)}
          onCommit={commitTransform(single.id)}
          override={dragPos?.id === single.id ? dragPos : null}
          onBodyDown={(e) => startDrag(single, e)}
          onBodyClick={surface('object', single.id)}
          onBodyMenu={ctx(single.id)}
        >
          {singleEntry?.model.kind === 'glb' ? (
            <GlbModel obj={single} entry={singleEntry} shadows={dh} />
          ) : (
            <SelectedMesh
              obj={single}
              geom={geomFor(single).g}
              material={selMat}
              surface={furnSurface(single)}
              emissive={dh ? emissiveOf(single) : undefined}
              color={bodyColor(single)}
              shadows={dh && (single.appearance?.castShadow ?? true)}
            />
          )}
        </SelectedObject>
      )}
      {selectedLight && <LightGizmo light={selectedLight} color={night ? '#ffd166' : theme.primary} />}
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
  onDown,
  onMenu,
}: {
  geom: THREE.BufferGeometry;
  objs: SceneObject[];
  material: THREE.Material | THREE.Material[];
  colorOf: (o: SceneObject) => THREE.Color;
  selected: Set<string>;
  highlight: string;
  shadows?: boolean;
  onPick: (o: SceneObject, e: ThreeEvent<MouseEvent>) => void;
  onDown?: (o: SceneObject, e: ThreeEvent<PointerEvent>) => void;
  onMenu?: (o: SceneObject, e: ThreeEvent<MouseEvent>) => void;
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
        if (o) onPick(o, e);
      }}
      onPointerDown={(e) => {
        const o = e.instanceId !== undefined ? objs[e.instanceId] : undefined;
        if (o) onDown?.(o, e);
      }}
      onContextMenu={(e) => {
        const o = e.instanceId !== undefined ? objs[e.instanceId] : undefined;
        if (o) onMenu?.(o, e);
      }}
    />
  );
}

/** 使用者上傳的 GLB 模型（載入中顯示淡色包圍盒） */
function GlbModel({ obj, entry, shadows }: { obj: SceneObject; entry: CatalogEntry; shadows: boolean }) {
  const url = entry.model.kind === 'glb' ? entry.model.url : undefined;
  const m = useModel(url);
  const invalidate = useThree((s) => s.invalidate);
  const inst = useMemo(
    () => (m && m !== 'error' ? instantiateModel(m, entry.dimsMm, { id: obj.id }, shadows) : null),
    [m, entry.dimsMm, obj.id, shadows],
  );
  useEffect(() => invalidate(), [inst, invalidate]);
  if (inst) return <primitive object={inst} />;
  const { w, d, h } = entry.dimsMm;
  return (
    <mesh position={[0, h / 2, 0]} userData={{ gkind: 'object', id: obj.id }}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={m === 'error' ? '#c0392b' : '#b9b3a8'} transparent opacity={0.5} />
    </mesh>
  );
}

function SelectedMesh({
  obj,
  geom,
  material,
  surface,
  emissive,
  color,
  shadows,
}: {
  obj: SceneObject;
  geom: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  surface: { roughness: number; metalness: number; opacity: number };
  emissive?: THREE.Material;
  color: THREE.Color;
  shadows?: boolean;
}) {
  const mat = useMemo(() => {
    const m = material.clone();
    m.color = color;
    m.roughness = surface.roughness;
    m.metalness = surface.metalness;
    if (surface.opacity < 1) {
      m.transparent = true;
      m.opacity = surface.opacity;
    }
    return m;
  }, [material, color, surface.roughness, surface.metalness, surface.opacity]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh
      geometry={geom}
      material={emissive ? [mat, emissive] : mat}
      castShadow={shadows}
      receiveShadow={shadows}
      userData={{ gkind: 'object', id: obj.id }}
    />
  );
}

function SelectedObject({
  obj,
  level,
  mode,
  uniform,
  catalog,
  onDragging,
  onCommit,
  children,
  override,
  onBodyDown,
  onBodyClick,
  onBodyMenu,
}: {
  override?: { pos: [number, number, number]; rot: number } | null;
  onBodyDown?: (e: ThreeEvent<PointerEvent>) => void;
  onBodyClick?: (e: ThreeEvent<MouseEvent>) => void;
  onBodyMenu?: (e: ThreeEvent<MouseEvent>) => void;
  obj: SceneObject;
  level: Level;
  mode: Viewer3DProps['transformMode'];
  uniform: boolean;
  catalog: Catalog;
  onDragging?: (v: boolean) => void;
  onCommit: (t: {
    position?: [number, number, number];
    rotationY?: number;
    scale?: [number, number, number];
  }) => void;
  children: ReactNode;
}) {
  const proxy = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(false);
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
        position={override ? override.pos : [obj.position[0], obj.position[1], obj.position[2]]}
        rotation={[0, override ? override.rot : obj.rotationY, 0]}
        scale={[s[0], s[1], s[2]]}
        onPointerDown={onBodyDown}
        onClick={onBodyClick}
        onContextMenu={onBodyMenu}
      >
        {children}
      </group>
      {ready && proxy.current && !obj.locked && !override && (
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
