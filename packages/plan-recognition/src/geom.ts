import type { Vec2 } from './types.js';

/** 牆段（cv-service model.py 的 Seg） */
export interface Seg {
  a: Vec2;
  b: Vec2;
  thickness: number;
  confidence: number;
  meta?: Record<string, unknown>;
}
export const seg = (
  a: Vec2,
  b: Vec2,
  thickness: number,
  confidence = 0.8,
  meta: Record<string, unknown> = {},
): Seg => ({
  a,
  b,
  thickness,
  confidence,
  meta,
});
export const len = (s: Pick<Seg, 'a' | 'b'>) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
export const angle = (s: Pick<Seg, 'a' | 'b'>) => Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const dir = (s: Seg): Vec2 => {
  const L = len(s) || 1;
  return [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
};
const deg = (r: number) => (r * 180) / Math.PI;
/** 兩方向夾角（0–90°，不分正反向） */
export const angleDiff = (p: Seg, q: Seg) => {
  const d = ((Math.abs(deg(angle(p) - angle(q))) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

/** 接近水平/垂直（±tol）的牆吸附成正交 */
export function orthogonalSnap(segs: Seg[], tolDeg = 6): Seg[] {
  return segs.map((s) => {
    const a = ((deg(angle(s)) % 180) + 180) % 180;
    if (Math.min(a, 180 - a) <= tolDeg) {
      const y = (s.a[1] + s.b[1]) / 2;
      return { ...s, a: [s.a[0], y], b: [s.b[0], y] };
    }
    if (Math.abs(a - 90) <= tolDeg) {
      const x = (s.a[0] + s.b[0]) / 2;
      return { ...s, a: [x, s.a[1]], b: [x, s.b[1]] };
    }
    return s;
  });
}

/** 共線且重疊／相距 < gap 的段合併 */
export function mergeCollinear(input: Seg[], gap: number, offsetTol: number, angleTolDeg = 2): Seg[] {
  const segs = input.filter((s) => len(s) > 0);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const p = segs[i];
        const q = segs[j];
        if (angleDiff(p, q) > angleTolDeg) continue;
        const u = dir(p);
        const n: Vec2 = [-u[1], u[0]];
        const off = Math.abs((q.a[0] - p.a[0]) * n[0] + (q.a[1] - p.a[1]) * n[1]);
        const off2 = Math.abs((q.b[0] - p.a[0]) * n[0] + (q.b[1] - p.a[1]) * n[1]);
        if (Math.max(off, off2) > offsetTol) continue;
        const t = (pt: Vec2) => (pt[0] - p.a[0]) * u[0] + (pt[1] - p.a[1]) * u[1];
        const p0 = 0;
        const p1 = len(p);
        const [q0, q1] = [t(q.a), t(q.b)].sort((x, y) => x - y) as [number, number];
        if (q0 > p1 + gap || p0 > q1 + gap) continue;
        const lo = Math.min(p0, q0);
        const hi = Math.max(p1, q1);
        const Lp = len(p);
        const Lq = len(q);
        segs[i] = {
          a: [p.a[0] + u[0] * lo, p.a[1] + u[1] * lo],
          b: [p.a[0] + u[0] * hi, p.a[1] + u[1] * hi],
          thickness: Lp >= Lq ? p.thickness : q.thickness,
          confidence: (Lp * p.confidence + Lq * q.confidence) / Math.max(1e-9, Lp + Lq),
          meta: { ...q.meta, ...p.meta },
        };
        segs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return segs;
}

export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** 端點吸附（容差 ≈ 牆厚）：延伸／縮回到最近的另一面牆中心線，形成 L/T 接點 */
export function snapEndpoints(segs: Seg[], tolFactor = 1): Seg[] {
  const out = segs.map((s) => ({ ...s, a: [...s.a] as Vec2, b: [...s.b] as Vec2 }));
  out.forEach((s, i) => {
    for (const end of ['a', 'b'] as const) {
      const pt = s[end];
      let best: [number, Vec2] | null = null;
      out.forEach((o, j) => {
        if (i === j || angleDiff(s, o) < 30) return;
        const inter = lineIntersection(s.a, s.b, o.a, o.b);
        if (!inter) return;
        const u = dir(o);
        const t = (inter[0] - o.a[0]) * u[0] + (inter[1] - o.a[1]) * u[1];
        if (t < -o.thickness || t > len(o) + o.thickness) return;
        const dd = dist(pt, inter);
        const tol = (Math.max(s.thickness, o.thickness) * 1.5 + 2) * tolFactor;
        if (dd <= tol && (!best || dd < best[0])) best = [dd, inter];
      });
      if (best) s[end] = (best as [number, Vec2])[1];
    }
  });
  return out;
}

/** (沿牆位置 t, 垂直距離) */
export function projectOn(s: Pick<Seg, 'a' | 'b'>, pt: Vec2): [number, number] {
  const L = len(s) || 1;
  const u: Vec2 = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
  const dx = pt[0] - s.a[0];
  const dy = pt[1] - s.a[1];
  return [dx * u[0] + dy * u[1], Math.abs(-dx * u[1] + dy * u[0])];
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
