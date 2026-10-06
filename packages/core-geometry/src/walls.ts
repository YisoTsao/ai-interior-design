import type { Level, Wall } from '@interiorai/scene-schema';
import { offsetPolygon, roundCorners, unionPolygons, type Polygon } from './clip.js';
import {
  add,
  closestOnSegment,
  cross,
  dot,
  eq,
  len,
  lineIntersect,
  norm,
  perp,
  scale,
  sub,
  type Vec2,
} from './vec.js';

/** 端點視為相接的容差（mm） */
export const JOINT_TOLERANCE = 1;
/** 共線判定：|sin θ| 小於此值視為平行（約 1°） */
const PARALLEL_SIN = Math.sin((1 * Math.PI) / 180);

export const wallLength = (w: Pick<Wall, 'a' | 'b'>) => len(sub(w.b as Vec2, w.a as Vec2));
export const wallDir = (w: Pick<Wall, 'a' | 'b'>): Vec2 => norm(sub(w.b as Vec2, w.a as Vec2));
/** 牆上距 a 端 offset 的點 */
export const pointOnWall = (w: Pick<Wall, 'a' | 'b'>, offset: number): Vec2 =>
  add(w.a as Vec2, scale(wallDir(w), offset));

type End = 'a' | 'b';
interface EndInfo {
  wall: Wall;
  end: End;
  /** 從接點往牆內的方向 */
  u: Vec2;
  h: number;
}

const endPoint = (w: Wall, end: End) => (end === 'a' ? w.a : w.b) as Vec2;
const endInfo = (w: Wall, end: End): EndInfo => {
  const d = wallDir(w);
  return { wall: w, end, u: end === 'a' ? d : scale(d, -1), h: w.thickness / 2 };
};

/** 同一端點相接的其他牆端 */
function jointPartners(walls: readonly Wall[], w: Wall, end: End): EndInfo[] {
  const p = endPoint(w, end);
  const out: EndInfo[] = [];
  for (const o of walls) {
    if (o.id === w.id) continue;
    if (eq(o.a as Vec2, p, JOINT_TOLERANCE)) out.push(endInfo(o, 'a'));
    if (eq(o.b as Vec2, p, JOINT_TOLERANCE)) out.push(endInfo(o, 'b'));
  }
  return out;
}

/** 端點落在其他牆中段（T 型接點）的宿主牆 */
function tHosts(walls: readonly Wall[], w: Wall, end: End): Wall[] {
  const p = endPoint(w, end);
  return walls.filter((o) => {
    if (o.id === w.id) return false;
    const c = closestOnSegment(p, o.a as Vec2, o.b as Vec2);
    return (
      c.distance <= JOINT_TOLERANCE &&
      c.t > 0 &&
      c.t < 1 &&
      !eq(o.a as Vec2, p, JOINT_TOLERANCE) &&
      !eq(o.b as Vec2, p, JOINT_TOLERANCE)
    );
  });
}

/**
 * 計算一個牆端的兩個角點 [minusSide, plusSide]（相對於 a→b 方向的右側/左側）。
 * - 自由端：方形端蓋
 * - 兩牆相接且不共線：真斜接（兩條邊線交點），任意角度、任意厚度皆精確
 * - T 型/3 牆以上/極銳角：延伸「其他牆半厚」的方形端蓋，交由聯集處理
 */
function endCorners(walls: readonly Wall[], w: Wall, end: End): [Vec2, Vec2] {
  const self = endInfo(w, end);
  const p = endPoint(w, end);
  const n = perp(wallDir(w)); // a→b 的左法線
  const h = self.h;
  const square = (ext: number): [Vec2, Vec2] => {
    const q = add(p, scale(self.u, -ext));
    return [add(q, scale(n, -h)), add(q, scale(n, h))];
  };

  const partners = jointPartners(walls, w, end);
  if (partners.length === 1) {
    const o = partners[0]!;
    const sin = cross(self.u, o.u);
    if (Math.abs(sin) < PARALLEL_SIN) return square(0); // 共線或反折：平頭
    // i 的左邊線(+)與 j 的右邊線(−)交點 A；i 的右邊線(−)與 j 的左邊線(+)交點 B（見 ADR-013 附註）
    const ni = perp(self.u);
    const nj = perp(o.u);
    const A = lineIntersect(add(p, scale(ni, h)), self.u, add(p, scale(nj, -o.h)), o.u);
    const B = lineIntersect(add(p, scale(ni, -h)), self.u, add(p, scale(nj, o.h)), o.u);
    const limit = 4 * Math.max(h, o.h) + 1;
    if (A && B && len(sub(A, p)) <= limit && len(sub(B, p)) <= limit) {
      // 在 a 端 self.u 與 a→b 同向，i 的 + 邊＝quad 的 plus 邊；b 端則相反
      return end === 'a' ? [B, A] : [A, B];
    }
    return square(Math.min(o.h, 2 * h)); // 極銳角：限制延伸避免尖刺
  }
  if (partners.length > 1) return square(Math.max(...partners.map((q) => q.h)));
  const hosts = tHosts(walls, w, end);
  if (hosts.length) return square(Math.max(...hosts.map((q) => q.thickness / 2)));
  return square(0);
}

/** 單一牆體的 2D 多邊形（逆時針） */
export function wallQuad(walls: readonly Wall[], w: Wall): Vec2[] {
  const [aMinus, aPlus] = endCorners(walls, w, 'a');
  const [bMinus, bPlus] = endCorners(walls, w, 'b');
  return [aMinus, bMinus, bPlus, aPlus];
}

/** 牆體 2D 輪廓（含 L/T/X 接合與洞），座標為整數 mm（S1.3/S1.4） */
export function wallOutline(level: Pick<Level, 'walls'>): Polygon[] {
  const walls = level.walls.filter((w) => wallLength(w) > 0);
  return unionPolygons(walls.map((w) => wallQuad(walls, w)));
}

/**
 * 建物外框（剖面模型的底座輪廓）：牆體聯集的外環（捨棄洞＝室內），外擴 margin 並倒圓角 radius。
 */
export function buildingFootprint(level: Pick<Level, 'walls'>, margin = 0, radius = 0): Vec2[][] {
  const outer = wallOutline(level).map((p) => p.outer);
  const grown = margin ? offsetPolygon(outer, margin) : outer;
  return radius ? roundCorners(grown, radius) : grown;
}

/** 兩牆是否共線且端點相接（可合併） */
export function areCollinearJoined(a: Wall, b: Wall): boolean {
  const shared =
    eq(a.a as Vec2, b.a as Vec2, JOINT_TOLERANCE) ||
    eq(a.a as Vec2, b.b as Vec2, JOINT_TOLERANCE) ||
    eq(a.b as Vec2, b.a as Vec2, JOINT_TOLERANCE) ||
    eq(a.b as Vec2, b.b as Vec2, JOINT_TOLERANCE);
  return shared && Math.abs(cross(wallDir(a), wallDir(b))) < PARALLEL_SIN && a.thickness === b.thickness;
}

/** 開口在牆上的世界座標區段（中心線上） */
export function openingSegment(w: Pick<Wall, 'a' | 'b'>, offset: number, width: number): [Vec2, Vec2] {
  return [pointOnWall(w, offset), pointOnWall(w, offset + width)];
}

export { dot };

/**
 * 三點弧（FE-PLAN-02）：起點 a、終點 b、弧上一點 m → 以折線近似（每段約 segMm，至少 4 段）。
 * 三點共線時回傳 [a, b]。回傳整數 mm。
 */
export function arcPoints(a: Vec2, b: Vec2, m: Vec2, segMm = 400): Vec2[] {
  const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-6) return [a, b];
  const sq = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (b[1] - m[1]) + sq(b) * (m[1] - a[1]) + sq(m) * (a[1] - b[1])) / d;
  const cy = (sq(a) * (m[0] - b[0]) + sq(b) * (a[0] - m[0]) + sq(m) * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const ang = (p: Vec2) => Math.atan2(p[1] - cy, p[0] - cx);
  const a0 = ang(a);
  let a1 = ang(b);
  const am = ang(m);
  // 方向：由 a 經過 m 到 b
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0);
  let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  if (sweep === 0) sweep = ccw ? 2 * Math.PI : -2 * Math.PI;
  a1 = a0 + sweep;
  const n = Math.max(4, Math.ceil((Math.abs(sweep) * r) / segMm));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    out.push([Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r)]);
  }
  out[0] = [Math.round(a[0]), Math.round(a[1])];
  out[n] = [Math.round(b[0]), Math.round(b[1])];
  return out;
}
