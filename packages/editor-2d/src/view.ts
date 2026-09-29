import type { Vec2 } from '@interiorai/core-geometry';

/** 2D 視圖轉換：螢幕(px) = 世界(mm) × scale + offset。平面 (x, z) → 螢幕 (x, y)。 */
export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

/** 縮放範圍限制（B4：避免浮點誤差）：1px = 0.5mm … 100mm */
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 2;

export const worldToScreen = (v: ViewTransform, p: Vec2): Vec2 => [
  p[0] * v.scale + v.ox,
  p[1] * v.scale + v.oy,
];
export const screenToWorld = (v: ViewTransform, p: Vec2): Vec2 => [
  (p[0] - v.ox) / v.scale,
  (p[1] - v.oy) / v.scale,
];

/** 以螢幕點為中心縮放（滾輪） */
export function zoomAt(v: ViewTransform, screen: Vec2, factor: number): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const w = screenToWorld(v, screen);
  return { scale, ox: screen[0] - w[0] * scale, oy: screen[1] - w[1] * scale };
}

/** 讓 bbox 置中並留邊（空場景給預設 8m×6m 視野） */
export function fitView(
  bbox: { min: Vec2; max: Vec2 } | null,
  size: { w: number; h: number },
  padding = 60,
): ViewTransform {
  const b = bbox ?? { min: [-1000, -1000] as Vec2, max: [7000, 5000] as Vec2 };
  const bw = Math.max(1000, b.max[0] - b.min[0]);
  const bh = Math.max(1000, b.max[1] - b.min[1]);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((size.w - padding * 2) / bw, (size.h - padding * 2) / bh)),
  );
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  return { scale, ox: size.w / 2 - cx * scale, oy: size.h / 2 - cy * scale };
}

export function bboxOf(points: Iterable<readonly number[]>): { min: Vec2; max: Vec2 } | null {
  let min: Vec2 | null = null;
  let max: Vec2 = [0, 0];
  for (const p of points) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    if (!min) {
      min = [x, y];
      max = [x, y];
    } else {
      min = [Math.min(min[0], x), Math.min(min[1], y)];
      max = [Math.max(max[0], x), Math.max(max[1], y)];
    }
  }
  return min ? { min, max } : null;
}

/** 依縮放選擇格線間距（mm）：螢幕上至少 12px */
export function gridStep(scale: number): number {
  for (const s of [100, 500, 1000, 5000, 10000]) if (s * scale >= 12) return s;
  return 50000;
}

export type LengthUnit = 'mm' | 'cm' | 'm';
export type AreaUnit = 'm2' | 'ping';
export const PING_M2 = 3.3058;

export function formatLength(mm: number, unit: LengthUnit): string {
  if (unit === 'mm') return `${Math.round(mm)} mm`;
  if (unit === 'cm') return `${(mm / 10).toFixed(mm % 10 === 0 ? 0 : 1)} cm`;
  return `${(mm / 1000).toFixed(2)} m`;
}
export function formatArea(mm2: number, unit: AreaUnit): string {
  const m2 = mm2 / 1e6;
  return unit === 'ping' ? `${(m2 / PING_M2).toFixed(2)} 坪` : `${m2.toFixed(2)} m²`;
}
/** 解析使用者輸入的長度（可帶 mm/cm/m；無單位時用偏好單位）；非法回 null */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  const u = (m[2] as LengthUnit | undefined) ?? unit;
  const mm = u === 'mm' ? v : u === 'cm' ? v * 10 : v * 1000;
  return Number.isFinite(mm) ? Math.round(mm) : null;
}
