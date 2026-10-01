import type { Level } from '@interiorai/scene-schema';
import { detectRooms } from './rooms.js';
import { pointInPolygon, type Vec2 } from './vec.js';
import { wallLength } from './walls.js';

/** 一條尺寸鏈：沿 a→b 的直線，ticks 為線上的分段點（世界座標） */
export interface DimChain {
  side: 'top' | 'bottom' | 'left' | 'right';
  kind: 'segments' | 'total';
  a: Vec2;
  b: Vec2;
  ticks: Vec2[];
}

/**
 * 自動外部尺寸（FE-PLAN-10）：每個方向（上下左右）兩道尺寸鏈——
 * 內道＝分段（外牆中心線端點與門窗邊）、外道＝總尺寸（外牆外緣到外緣）。
 * 只取朝外（一側是房間、另一側不是）且面向該方向的牆，所以 L 型、凹字型平面也正確。
 * gap：外牆外緣到第一道尺寸線的距離；step：兩道之間的距離（mm）。
 */
export function exteriorDimensionChains(
  level: Pick<Level, 'walls' | 'openings'>,
  gap = 700,
  step = 500,
): DimChain[] {
  const floors = detectRooms(level).rooms.map((r) => r.floor);
  if (!floors.length) return [];
  const inside = (p: Vec2) => floors.some((f) => pointInPolygon(p, f));
  type Face = { side: DimChain['side']; along: number[]; outer: number; span: [number, number] };
  const faces: Face[] = [];
  for (const w of level.walls) {
    const L = wallLength(w);
    if (L < 1) continue;
    const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const n: Vec2 = [-d[1], d[0]];
    const off = w.thickness / 2 + 60;
    const m: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    // 多點取樣：只看中點時，中點剛好在 T 字接點會落在另一道牆體內（不屬任何房間）→ 誤判為外牆
    let left = false;
    let right = false;
    for (const t of [0.2, 0.5, 0.8]) {
      const q: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
      left ||= inside([q[0] + n[0] * off, q[1] + n[1] * off]);
      right ||= inside([q[0] - n[0] * off, q[1] - n[1] * off]);
    }
    if (left === right) continue;
    const out: Vec2 = left ? [-n[0], -n[1]] : n;
    const side: DimChain['side'] | null =
      out[1] < -0.9
        ? 'top'
        : out[1] > 0.9
          ? 'bottom'
          : out[0] < -0.9
            ? 'left'
            : out[0] > 0.9
              ? 'right'
              : null;
    if (!side) continue; // 斜牆不標
    const horiz = side === 'top' || side === 'bottom';
    const ax = (p: Vec2) => (horiz ? p[0] : p[1]);
    const along = [ax(w.a), ax(w.b)];
    for (const o of level.openings)
      if (o.wallId === w.id)
        along.push(
          ax([w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset]),
          ax([w.a[0] + d[0] * (o.offset + o.width), w.a[1] + d[1] * (o.offset + o.width)]),
        );
    const outerPt: Vec2 = [m[0] + out[0] * (w.thickness / 2), m[1] + out[1] * (w.thickness / 2)];
    const lo = Math.min(ax(w.a), ax(w.b)) - w.thickness / 2;
    const hi = Math.max(ax(w.a), ax(w.b)) + w.thickness / 2;
    faces.push({ side, along, outer: horiz ? outerPt[1] : outerPt[0], span: [lo, hi] });
  }
  const chains: DimChain[] = [];
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const fs = faces.filter((f) => f.side === side);
    if (!fs.length) continue;
    const horiz = side === 'top' || side === 'bottom';
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    // 尺寸線放在這個方向最外側外緣之外
    const edge = sign < 0 ? Math.min(...fs.map((f) => f.outer)) : Math.max(...fs.map((f) => f.outer));
    const at = (c: number, k: number): Vec2 => {
      const q = edge + sign * (gap + k * step);
      return horiz ? [c, q] : [q, c];
    };
    const ticks = [...new Set(fs.flatMap((f) => f.along).map((v) => Math.round(v)))].sort((x, y) => x - y);
    const merged = ticks.filter((v, i) => i === 0 || v - ticks[i - 1]! > 1);
    if (merged.length >= 2)
      chains.push({
        side,
        kind: 'segments',
        a: at(merged[0]!, 0),
        b: at(merged.at(-1)!, 0),
        ticks: merged.map((v) => at(v, 0)),
      });
    const lo = Math.min(...fs.map((f) => f.span[0]));
    const hi = Math.max(...fs.map((f) => f.span[1]));
    chains.push({ side, kind: 'total', a: at(lo, 1), b: at(hi, 1), ticks: [at(lo, 1), at(hi, 1)] });
  }
  return chains;
}
