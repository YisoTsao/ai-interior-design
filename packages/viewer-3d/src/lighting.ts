import { objectDims, resolveParams, type Catalog, type CatalogEntry } from '@interiorai/catalog';
import { pointOnWall, wallLength } from '@interiorai/core-geometry';
import type { Environment, Level, LightOverride, SceneObject } from '@interiorai/scene-schema';
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
  /** 聚光邊緣柔化 0–1 */
  penumbra?: number;
  /** 陰影柔和度（PCF 半徑） */
  shadowSoftness?: number;
  /** 衰減截止距離 mm（0／未設定＝物理無限） */
  rangeMm?: number;
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

/** 繞物件局部 X（俯仰）再繞 Y（水平）旋轉方向向量 */
const aim = (d: Vec3, tiltDeg = 0, panDeg = 0): Vec3 => {
  const t = (tiltDeg * Math.PI) / 180;
  const p = (panDeg * Math.PI) / 180;
  // 正的俯仰角把光束往燈具正面（+Z）轉
  const y1 = d[1] * Math.cos(t) + d[2] * Math.sin(t);
  const z1 = -d[1] * Math.sin(t) + d[2] * Math.cos(t);
  return rotDir([d[0], y1, z1], p);
};

/**
 * 燈具的有效光學參數：目錄 light 規格 ← 物件參數（color、dimmer）← 物件光源覆寫 o.light（ADR-023）。
 * 回傳 null 表示不發光（關燈、調光 0、隱藏）。
 */
export function effectiveLight(o: SceneObject, e: CatalogEntry | undefined) {
  const L = e?.light;
  if (!e || !L) return null;
  const ov: LightOverride = o.light ?? {};
  const p = resolveParams(e, o.params);
  const dim = typeof p.dimmer === 'number' ? p.dimmer / 100 : 1;
  if (ov.on === false || dim <= 0 || o.appearance?.hidden) return null;
  const color =
    ov.color ??
    (ov.kelvin ? kelvinToHex(ov.kelvin) : lightColorHex(typeof p.color === 'string' ? p.color : undefined));
  const baseLumens = ov.lumens ?? L.lumens;
  return {
    spec: L,
    color,
    lumens: baseLumens * dim,
    /** 相對目錄預設的亮度比（自發光燈體亮度用） */
    ratio: L.lumens > 0 ? (baseLumens * dim) / L.lumens : dim,
    beamDeg: ov.beamDeg ?? L.beamDeg,
    penumbra: ov.penumbra,
    castShadow: ov.castShadow ?? L.castShadow,
    shadowSoftness: ov.shadowSoftness,
    rangeMm: ov.rangeMm,
    tiltDeg: ov.tiltDeg ?? 0,
    panDeg: ov.panDeg ?? 0,
  };
}

/** 場景中所有燈具的光源（目錄 light 規格＋物件參數 color/dimmer＋光源覆寫） */
export function fixtureLights(level: Pick<Level, 'objects'>, catalog: Catalog): LightSource[] {
  const out: LightSource[] = [];
  for (const o of level.objects) {
    const e: CatalogEntry | undefined = catalog.get(o.catalogId);
    const eff = effectiveLight(o, e);
    if (!e || !eff) continue;
    const L = eff.spec;
    const s = o.scale ?? [1, 1, 1];
    // 參數化尺寸變動時，發光點依高度比例移動（例如立燈調高）
    const dims = objectDims(e, o.params);
    const k: Vec3 = [dims.w / e.dimsMm.w, dims.h / e.dimsMm.h, dims.d / e.dimsMm.d];
    const local: Vec3 = [L.offset[0] * k[0], L.offset[1] * k[1], L.offset[2] * k[2]];
    const dir = rotDir(aim(FACING[L.facing]!, eff.tiltDeg, eff.panDeg), o.rotationY);
    out.push({
      id: o.id,
      kind: L.kind,
      position: toWorld(local, o.position, o.rotationY, s),
      direction: dir,
      color: eff.color,
      lumens: eff.lumens,
      beamDeg: eff.beamDeg,
      size: L.size
        ? { w: L.size.w * k[0] * (s[0] ?? 1), h: L.size.h * (L.facing === 'up' ? k[2] : k[1]) }
        : undefined,
      up: L.facing === 'front' ? [0, 1, 0] : rotDir([0, 0, 1], o.rotationY),
      castShadow: eff.castShadow,
      penumbra: eff.penumbra,
      shadowSoftness: eff.shadowSoftness,
      rangeMm: eff.rangeMm,
      ceiling: e.anchor === 'ceiling',
      source: 'fixture',
    });
  }
  return out;
}

/**
 * 室外天空（夜間）的亮度 cd/m² 與色彩：窗戶在夜間不是光源，而是「看得到天空的洞」——
 * 面光源亮度＝天空亮度（物理：透過開口看到的輻射亮度不變）。數值取各情境的上緣：
 * 無月 0.001、滿月 0.05、城市光害 0.5、藍調時刻（民用曙暮光）15。
 */
export type SkyPreset = NonNullable<Environment['sky']>;
export const NIGHT_SKY: Record<SkyPreset, { luminance: number; color: string }> = {
  moonless: { luminance: 0.001, color: '#5b6b9a' },
  moonlit: { luminance: 0.05, color: '#8ea3d6' },
  city: { luminance: 0.5, color: '#9aa6c4' },
  dusk: { luminance: 15, color: '#6f8fd8' },
};
export const DEFAULT_SKY: SkyPreset = 'city';
/** 向下相容：舊版窗光以 700 lm/m² 模擬（ADR-021），ADR-023 起改用天空亮度 */
export const WINDOW_LM_PER_M2 = 700;
export function windowLights(
  level: Pick<Level, 'walls' | 'openings'>,
  sides: Map<string, WallSide>,
  sky: SkyPreset = DEFAULT_SKY,
): LightSource[] {
  const S = NIGHT_SKY[sky];
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
      color: S.color,
      // 面光源亮度＝天空亮度：flux = π·L·A
      lumens: Math.PI * S.luminance * ((o.width * o.height) / 1e6),
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

/**
 * 間接光（多次反射）的平均照度估計（積分球公式）：E = Φ·ρ̄ / (A·(1−ρ̄))。
 * three.js 沒有全域照明，以半球光補上這一項；顏色取各光源依光通量加權的平均色。
 * surfaces：室內各類表面的面積 m² 與反射率；開頂（無天花）、被剖掉的牆面以反射率 0 計入（光逸散）。
 */
export interface IndirectSurface {
  areaM2: number;
  reflectance: number;
}
export function indirectEstimate(
  lights: readonly Pick<LightSource, 'lumens' | 'color'>[],
  surfaces: readonly IndirectSurface[],
): { lux: number; color: string; reflectance: number } {
  const flux = lights.reduce((a, l) => a + l.lumens, 0);
  const area = Math.max(
    1,
    surfaces.reduce((a, x) => a + x.areaM2, 0),
  );
  const rho = Math.min(0.9, surfaces.reduce((a, x) => a + x.areaM2 * x.reflectance, 0) / area);
  const lux = (flux * rho) / (area * (1 - rho));
  let r = 0;
  let g = 0;
  let b = 0;
  for (const l of lights) {
    const n = parseInt(l.color.replace('#', ''), 16);
    r += ((n >> 16) & 255) * l.lumens;
    g += ((n >> 8) & 255) * l.lumens;
    b += (n & 255) * l.lumens;
  }
  const hex = (v: number) =>
    Math.round(flux > 0 ? v / flux : 200)
      .toString(16)
      .padStart(2, '0');
  return { lux, color: `#${hex(r)}${hex(g)}${hex(b)}`, reflectance: rho };
}
