import { objectDims, resolveParams, type Catalog, type CatalogEntry } from '@interiorai/catalog';
import { pointOnWall, wallLength } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';
import type { WallSide } from './style.js';

/** 3D 光線模式：day＝日光（images2）；night＝夜間氛圍，燈具為主要光源（images1） */
export type LightingMode = 'day' | 'night';

export type Vec3 = [number, number, number];

/** 光色預設 → sRGB hex（色溫以 Tanner Helland 近似） */
const RGB_PRESETS: Record<string, string> = {
  amber: '#ffae42',
  red: '#ff3b30',
  pink: '#ff5fa2',
  magenta: '#ff2bd6',
  purple: '#8b5cf6',
  blue: '#3b82f6',
  cyan: '#22d3ee',
  green: '#22c55e',
};

export function kelvinToHex(k: number): string {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function lightColorHex(preset: string | undefined): string {
  if (!preset) return kelvinToHex(3000);
  const k = /^(\d{4})K$/.exec(preset);
  return k ? kelvinToHex(Number(k[1])) : (RGB_PRESETS[preset] ?? kelvinToHex(3000));
}

export interface LightSource {
  /** 物件 id（窗戶光源為 opening id） */
  id: string;
  kind: 'point' | 'spot' | 'area';
  position: Vec3;
  /** 發光方向（單位向量） */
  direction: Vec3;
  color: string;
  /** 已套用調光的光通量 lm */
  lumens: number;
  beamDeg?: number;
  /** area：發光面 mm；up＝面的「上」方向 */
  size?: { w: number; h: number };
  up?: Vec3;
  castShadow: boolean;
  /** 天花板燈具（剖面模型中沒有天花板時只隱藏燈體、光仍照射） */
  ceiling: boolean;
  source: 'fixture' | 'window';
}

/** 物件局部 → 世界：繞 +Y 旋轉 θ（Three.js 右手系）＋縮放＋平移 */
const toWorld = (local: Vec3, pos: readonly number[], rot: number, s: readonly number[]): Vec3 => {
  const x = local[0] * (s[0] ?? 1);
  const y = local[1] * (s[1] ?? 1);
  const z = local[2] * (s[2] ?? 1);
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  return [pos[0]! + x * c + z * n, pos[1]! + y, pos[2]! - x * n + z * c];
};
const rotDir = (d: Vec3, rot: number): Vec3 => {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  return [d[0] * c + d[2] * n, d[1], -d[0] * n + d[2] * c];
};
const FACING: Record<string, Vec3> = { down: [0, -1, 0], up: [0, 1, 0], front: [0, 0, 1] };

/** 場景中所有燈具的光源（依目錄 light 規格＋物件參數 color/dimmer） */
export function fixtureLights(level: Pick<Level, 'objects'>, catalog: Catalog): LightSource[] {
  const out: LightSource[] = [];
  for (const o of level.objects) {
    const e: CatalogEntry | undefined = catalog.get(o.catalogId);
    const L = e?.light;
    if (!e || !L) continue;
    const p = resolveParams(e, o.params);
    const dim = typeof p.dimmer === 'number' ? p.dimmer / 100 : 1;
    if (dim <= 0) continue;
    const s = o.scale ?? [1, 1, 1];
    // 參數化尺寸變動時，發光點依高度比例移動（例如立燈調高）
    const dims = objectDims(e, o.params);
    const k: Vec3 = [dims.w / e.dimsMm.w, dims.h / e.dimsMm.h, dims.d / e.dimsMm.d];
    const local: Vec3 = [L.offset[0] * k[0], L.offset[1] * k[1], L.offset[2] * k[2]];
    const dir = rotDir(FACING[L.facing]!, o.rotationY);
    out.push({
      id: o.id,
      kind: L.kind,
      position: toWorld(local, o.position, o.rotationY, s),
      direction: dir,
      color: lightColorHex(typeof p.color === 'string' ? p.color : undefined),
      lumens: L.lumens * dim,
      beamDeg: L.beamDeg,
      size: L.size
        ? { w: L.size.w * k[0] * (s[0] ?? 1), h: L.size.h * (L.facing === 'up' ? k[2] : k[1]) }
        : undefined,
      up: L.facing === 'front' ? [0, 1, 0] : rotDir([0, 0, 1], o.rotationY),
      castShadow: L.castShadow,
      ceiling: e.anchor === 'ceiling',
      source: 'fixture',
    });
  }
  return out;
}

/** 窗戶：朝室內的面光源（夜間氛圍中窗戶是明亮的外部光，images1） */
export const WINDOW_LM_PER_M2 = 700;
export function windowLights(
  level: Pick<Level, 'walls' | 'openings'>,
  sides: Map<string, WallSide>,
): LightSource[] {
  const out: LightSource[] = [];
  for (const o of level.openings) {
    if (o.type !== 'window') continue;
    const w = level.walls.find((x) => x.id === o.wallId);
    const side = w ? sides.get(w.id) : undefined;
    if (!w || !side?.exterior || !side.outward) continue;
    const L = wallLength(w);
    if (L < 1) continue;
    const c = pointOnWall(w, o.offset + o.width / 2);
    const inward: Vec3 = [-side.outward[0], 0, -side.outward[1]];
    const inset = w.thickness / 2 + 5;
    out.push({
      id: o.id,
      kind: 'area',
      position: [c[0] + inward[0] * inset, (o.sill ?? 0) + o.height / 2, c[1] + inward[2] * inset],
      direction: inward,
      color: kelvinToHex(6500),
      lumens: ((o.width * o.height) / 1e6) * WINDOW_LM_PER_M2,
      size: { w: o.width, h: o.height },
      up: [0, 1, 0],
      castShadow: false,
      ceiling: false,
      source: 'window',
    });
  }
  return out;
}

/**
 * 光度 → three.js 物理單位。three 以「世界單位＝公尺」計算 1/d² 衰減；場景單位為 mm，
 * 故點光/聚光的發光強度（cd）要乘 1e6。面光源的強度是亮度（nit），與單位無關，只需以 m² 計算面積。
 */
export const MM_UNIT = 1e6;
export const pointIntensity = (lm: number) => (lm / (4 * Math.PI)) * MM_UNIT;
export const spotIntensity = (lm: number, beamDeg: number) =>
  (lm / (2 * Math.PI * (1 - Math.cos(((beamDeg / 2) * Math.PI) / 180)))) * MM_UNIT;
export const areaLuminance = (lm: number, wMm: number, hMm: number) =>
  lm / (Math.PI * Math.max(1e-6, (wMm * hMm) / 1e6));

export interface LightPools {
  point: LightSource[];
  spot: LightSource[];
  area: LightSource[];
}
export const POOL_SIZE = { point: 12, spot: 6, area: 8 } as const;
export const SHADOW_BUDGET = { point: 2, spot: 3 } as const;

/**
 * 依重要度（光通量 ÷ 與畫面焦點距離的衰減）挑出固定數量的即時光源；
 * 陰影只給最重要的幾盞（點光陰影需 6 張貼圖）。數量固定 → 光源增減不會觸發 shader 重新編譯。
 */
export function pickActive(
  lights: readonly LightSource[],
  focus: Vec3,
  pool = POOL_SIZE,
  shadows = SHADOW_BUDGET,
): LightPools {
  const score = (l: LightSource) => {
    const d = Math.hypot(l.position[0] - focus[0], l.position[1] - focus[1], l.position[2] - focus[2]) / 3000;
    return l.lumens / (1 + d * d);
  };
  const ranked = [...lights].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const take = (kind: LightSource['kind'], n: number, shadowN: number) =>
    ranked
      .filter((l) => l.kind === kind)
      .slice(0, n)
      .map((l, i) => ({ ...l, castShadow: l.castShadow && i < shadowN }));
  return {
    point: take('point', pool.point, shadows.point),
    spot: take('spot', pool.spot, shadows.spot),
    area: take('area', pool.area, 0),
  };
}
