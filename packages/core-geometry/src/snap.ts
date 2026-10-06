import type { Level } from '@interiorai/scene-schema';
import { closestOnSegment, dist, len, roundVec, sub, type Vec2 } from './vec.js';

export interface SnapContext {
  level: Pick<Level, 'walls'>;
  /** 吸附容差（mm，呼叫端依縮放把像素換成 mm） */
  tolerance: number;
  gridMm?: number;
  /** 角度吸附的參考點（例如連續畫牆的上一點） */
  angleFrom?: Vec2;
  angleStepRad?: number;
  /** 按住修飾鍵時暫時關閉（B3.5） */
  disabled?: boolean;
  /** 排除的牆（例如正在拖曳的牆本身） */
  excludeWallIds?: readonly string[];
  /** 吸附對象開關（FE-PLAN-13）；未指定＝全部開啟 */
  targets?: { endpoint?: boolean; wall?: boolean; angle?: boolean; grid?: boolean };
}

export type SnapKind = 'endpoint' | 'wall' | 'angle' | 'grid' | 'none';
export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  wallId?: string;
}

export const DEFAULT_ANGLE_STEP = (15 * Math.PI) / 180;

/** 吸附優先序：端點 > 牆線 > 角度 > 格線（B3.5）。回傳整數 mm。 */
export function snap(pt: Vec2, ctx: SnapContext): SnapResult {
  if (ctx.disabled) return { point: roundVec(pt), kind: 'none' };
  const walls = ctx.level.walls.filter((w) => !ctx.excludeWallIds?.includes(w.id));

  const on = { endpoint: true, wall: true, angle: true, grid: true, ...ctx.targets };
  let best: SnapResult | null = null;
  let bestD = ctx.tolerance;
  for (const w of on.endpoint ? walls : []) {
    for (const p of [w.a as Vec2, w.b as Vec2]) {
      const d = dist(pt, p);
      if (d <= bestD) {
        bestD = d;
        best = { point: [p[0], p[1]], kind: 'endpoint', wallId: w.id };
      }
    }
  }
  if (best) return best;

  bestD = ctx.tolerance;
  for (const w of on.wall ? walls : []) {
    const c = closestOnSegment(pt, w.a as Vec2, w.b as Vec2);
    if (c.distance <= bestD) {
      bestD = c.distance;
      best = { point: roundVec(c.point), kind: 'wall', wallId: w.id };
    }
  }
  if (best) return best;

  if (ctx.angleFrom && on.angle) {
    const step = ctx.angleStepRad ?? DEFAULT_ANGLE_STEP;
    const v = sub(pt, ctx.angleFrom);
    const l = len(v);
    if (l > 0) {
      const a = Math.round(Math.atan2(v[1], v[0]) / step) * step;
      const grid = on.grid ? ctx.gridMm : undefined;
      const length = grid ? Math.max(grid, Math.round(l / grid) * grid) : l;
      return {
        point: roundVec([ctx.angleFrom[0] + Math.cos(a) * length, ctx.angleFrom[1] + Math.sin(a) * length]),
        kind: 'angle',
      };
    }
  }
  if (ctx.gridMm && on.grid) {
    const g = ctx.gridMm;
    return { point: [Math.round(pt[0] / g) * g, Math.round(pt[1] / g) * g], kind: 'grid' };
  }
  return { point: roundVec(pt), kind: 'none' };
}
