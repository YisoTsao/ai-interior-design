import type { Vec2 } from '@interiorai/scene-schema';

export type { Vec2 };
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};
/** 左法線（逆時針 90°） */
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
export const eq = (a: Vec2, b: Vec2, tol = 0) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/**
 * 捨入到整數 mm：0.5 一律往 +∞（Math.round）。
 * 不用「遠離零」：它對整數平移不具不變性（property test 發現，ADR-013 修訂）。
 */
export const roundMm = (v: number) => Math.round(v) + 0; // +0 把 -0 正規化
export const roundVec = (a: Vec2): Vec2 => [roundMm(a[0]), roundMm(a[1])];

/** 兩直線 p+s·u 與 q+t·v 的交點；平行時回 null */
export function lineIntersect(p: Vec2, u: Vec2, q: Vec2, v: Vec2): Vec2 | null {
  const d = cross(u, v);
  if (Math.abs(d) < 1e-12) return null;
  const s = cross(sub(q, p), v) / d;
  return add(p, scale(u, s));
}

/** 點到線段最近點與參數 t∈[0,1] */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { point, t, distance: dist(p, point) };
}

/** 帶號面積（逆時針為正） */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const polygonArea = (poly: readonly Vec2[]) => Math.abs(signedArea(poly));

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

/**
 * 折線平移（FE-PLAN-15 牆的定位線）：每段沿左法線 [-dy, dx] 平移 d（負值＝右側），轉角以斜接相交；
 * closed＝封閉多邊形（首尾也斜接）。平行相鄰段（無交點）直接沿用平移後的端點。
 */
export function offsetPolyline(pts: readonly Vec2[], d: number, closed = false): Vec2[] {
  const n = pts.length;
  if (n < 2 || d === 0) return pts.map((p) => [p[0], p[1]] as Vec2);
  const segs: { p: Vec2; u: Vec2 }[] = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const u = norm(sub(b, a));
    segs.push({ p: add(a, scale(perp(u), d)), u });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? segs[(i - 1 + m) % m] : segs[i - 1];
    const next = closed ? segs[i % m] : segs[i];
    if (prev && next) {
      const x = lineIntersect(prev.p, prev.u, next.p, next.u);
      out.push(x ?? add(pts[i]!, scale(perp(next.u), d)));
    } else if (next) out.push(next.p);
    else out.push(add(pts[i]!, scale(perp(prev!.u), d)));
  }
  return out.map(roundVec);
}
