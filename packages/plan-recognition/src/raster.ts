import {
  adaptiveInv,
  andNot,
  blur3,
  clone,
  close,
  components,
  count,
  dilate,
  drawLine,
  keepLong,
  not,
  open,
  or,
  otsu,
  simplify,
  thresholdInv,
  traceContour,
  type Gray,
} from './image.js';
import {
  angleDiff,
  dist,
  len,
  median,
  mergeCollinear,
  projectOn,
  seg,
  snapEndpoints,
  type Seg,
} from './geom.js';
import { PlanParseError, type OpeningOut, type PlanResult, type RoomOut, type Vec2 } from './types.js';

/**
 * 點陣平面圖辨識（瀏覽器版，移植自 services/cv-service/app/raster/pipeline.py，06 §3）：
 * 前處理 → 傳統 CV 牆分割 → 向量化（正交牆：水平／垂直連續長度分類）→ 門窗符號與缺口 → 房間 → 尺度建議。
 * 與 Python 版的差異：沒有 OCR（尺度一律由使用者校正，並以門寬中位數預填建議值）、不做轉正（假設圖面水平）、
 * 斜牆不向量化（出警告）。有 cv-service 時前端可改呼叫服務取得 OCR 尺度與房名。
 */
export const MAX_SIDE = 8000;
const TYPICAL_DOOR_MM = 850;

export interface RasterOptions {
  /** 已知尺度（mm/px）；提供時直接輸出 mm */
  scaleMmPerPx?: number | null;
}

// ── 牆分割 ────────────────────────────────────────────────────────

export function segmentWalls(g: Gray): { mask: Gray; ink: Gray; conf: number; hollow: boolean } {
  const blur = blur3(g);
  const t = otsu(blur);
  let ink = thresholdInv(blur, Math.min(t, 150));
  ink = or(ink, adaptiveInv(blur, 31, 18));
  const side = Math.min(g.width, g.height);
  const opened = (m: Gray, frac: number) => keepLong(open(m, 4), Math.round(side * frac));
  const solid = opened(ink, 0.04);
  let best = { m: solid, k: 0, n: count(solid) };
  const base = Math.max(1, best.n);
  for (const k of [5, 7, 9, 13]) {
    const m = opened(close(ink, k), 0.13);
    const n = count(m);
    if (n > base * 1.8 && (best.k === 0 || n > best.n * 1.15)) best = { m, k, n };
  }
  return { mask: best.m, ink, conf: best.k === 0 ? 0.72 : 0.62, hollow: best.k > 0 };
}

// ── 向量化 ────────────────────────────────────────────────────────

/** 每個前景像素所在的水平／垂直連續長度 */
function runLengths(m: Gray): { H: Uint16Array; V: Uint16Array } {
  const { width: w, height: h, data } = m;
  const H = new Uint16Array(w * h);
  const V = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!data[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && data[y * w + e]) e++;
      for (let k = x; k < e; k++) H[y * w + k] = Math.min(65535, e - x);
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!data[y * w + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && data[e * w + x]) e++;
      for (let k = y; k < e; k++) V[k * w + x] = Math.min(65535, e - y);
      y = e;
    }
  }
  return { H, V };
}

const lineCov = (img: Gray, a: Vec2, b: Vec2, n = 24, r = 1, lo = 0.1, hi = 0.9) => {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1);
    s += inkNear(img, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r);
  }
  return s / n;
};
function inkNear(img: Gray, x: number, y: number, r = 2): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < r || yi < r || xi >= img.width - r || yi >= img.height - r) return 0;
  for (let yy = yi - r; yy <= yi + r; yy++)
    for (let xx = xi - r; xx <= xi + r; xx++) if (img.data[yy * img.width + xx]) return 1;
  return 0;
}

/**
 * 正交牆向量化：像素的水平連續長度 ≥ 1.5× 垂直長度 → 水平牆像素（反之垂直）；
 * 兩方向都長的接點像素不屬於任何一方（牆在接點處斷開，之後由共線合併與端點吸附接回）。
 * 各方向的連通元件 → 一段中心線；厚度＝垂直於牆方向的像素數中位數。
 */
export function vectorize(mask: Gray): { segs: Seg[]; t: number; diagonal: number } {
  const { width: w, height: h, data } = mask;
  const { H, V } = runLengths(mask);
  const thin: number[] = [];
  for (let i = 0; i < data.length; i += 3) if (data[i]) thin.push(Math.min(H[i], V[i]));
  const t = Math.max(2, median(thin));
  const minLen = Math.max(4, t * 2);
  const horiz = { width: w, height: h, data: new Uint8Array(w * h) };
  const vert = { width: w, height: h, data: new Uint8Array(w * h) };
  let unclassified = 0;
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    total++;
    if (H[i] >= minLen && H[i] >= 1.5 * V[i]) horiz.data[i] = 255;
    else if (V[i] >= minLen && V[i] >= 1.5 * H[i]) vert.data[i] = 255;
    else if (H[i] < minLen && V[i] < minLen) unclassified++;
  }
  const segs: Seg[] = [];
  const collect = (m: Gray, horizontal: boolean) => {
    const { labels, stats } = components(m, 8);
    const across = stats.map(() => new Map<number, number>()); // 沿牆位置 → 橫跨像素數
    const sumC = new Float64Array(stats.length);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (!l) continue;
      const x = i % w;
      const y = (i - x) / w;
      const along = horizontal ? x : y;
      across[l].set(along, (across[l].get(along) ?? 0) + 1);
      sumC[l] += horizontal ? y : x;
    }
    for (let l = 1; l < stats.length; l++) {
      const s = stats[l];
      const L = horizontal ? s.w : s.h;
      if (L < minLen) continue;
      const th = Math.max(2, median([...across[l].values()]));
      const c = sumC[l] / s.area + 0.5;
      const a: Vec2 = horizontal ? [s.x, c] : [c, s.y];
      const b: Vec2 = horizontal ? [s.x + s.w, c] : [c, s.y + s.h];
      segs.push(seg(a, b, th, 0.7));
    }
  };
  collect(horiz, true);
  collect(vert, false);
  let out = mergeCollinear(segs, t * 1.5, Math.max(2, t * 0.8));
  out = out.map((s) => {
    const n = Math.max(4, Math.round(len(s)));
    return { ...s, confidence: 0.5 + 0.45 * lineCov(mask, s.a, s.b, n, 0, 0, 1) };
  });
  out = snapEndpoints(out);
  return { segs: out.filter((s) => len(s) >= t * 1.2), t, diagonal: total ? unclassified / total : 0 };
}

// ── 門窗 ──────────────────────────────────────────────────────────

interface Op {
  type: 'door' | 'window' | 'wall' | 'gap';
  p0: Vec2;
  p1: Vec2;
  i?: number;
  j?: number | null;
  end?: 'a' | 'b' | null;
  swing?: 'left' | 'right' | null;
  confidence?: number;
}

/** 直接找門窗符號：牆外的細線元件（門＝近正方形外框貼著牆缺口；窗＝落在缺口中的細長線） */
export function detectSymbols(ink: Gray, mask: Gray, tPx: number): Op[] {
  const thin = andNot(ink, dilate(mask, 3));
  const { stats } = components(thin, 8);
  const t = Math.max(2, tPx);
  const r = Math.max(1, Math.floor(t / 3));
  const out: Op[] = [];
  for (let i = 1; i < stats.length; i++) {
    const { x, y, w, h, area } = stats[i];
    const side = Math.max(w, h);
    const short = Math.min(w, h);
    const cands: [Op['type'], Vec2, Vec2][] = [];
    if (side >= 2.5 * t && side <= 22 * t && short >= 0.7 * side && area < 0.35 * w * h)
      cands.push(
        ['door', [x, y], [x + w, y]],
        ['door', [x, y + h], [x + w, y + h]],
        ['door', [x, y], [x, y + h]],
        ['door', [x + w, y], [x + w, y + h]],
      );
    if (side >= 2.5 * t && short <= 1.8 * t)
      cands.push(
        w >= h
          ? ['window', [x, y + h / 2], [x + w, y + h / 2]]
          : ['window', [x + w / 2, y], [x + w / 2, y + h]],
      );
    let best: [number, Op['type'], Vec2, Vec2] | null = null;
    for (const [kind, a, b] of cands) {
      const L = dist(a, b);
      const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const ext = (p: Vec2, d: number): Vec2 => [p[0] + u[0] * d, p[1] + u[1] * d];
      const inside = lineCov(mask, a, b, 20, r, 0.15, 0.85);
      const before = lineCov(mask, ext(a, -2.2 * t), ext(a, -0.8 * t), 6, r, 0, 1);
      const after = lineCov(mask, ext(b, 0.8 * t), ext(b, 2.2 * t), 6, r, 0, 1);
      const sc = (1 - inside) * 0.4 + before * 0.3 + after * 0.3;
      if (inside < 0.3 && before > 0.6 && after > 0.6 && (!best || sc > best[0])) best = [sc, kind, a, b];
    }
    if (best)
      out.push({
        type: best[1],
        p0: best[2],
        p1: best[3],
        swing: null,
        confidence: Math.round((0.55 + 0.4 * best[0]) * 1000) / 1000,
      });
  }
  return out;
}

/** 缺口分類：wall（其實連續）／window（中線有細線）／door（鉸鏈端有 1/4 弧＋門扇）／none */
function classifyGap(
  ink: Gray,
  mask: Gray,
  g0: Vec2,
  g1: Vec2,
  t: number,
): [Op['type'] | 'none', number, 'left' | 'right' | null] {
  const gap = dist(g0, g1);
  if (lineCov(mask, g0, g1, 24, 0) > 0.35) return ['wall', 0, null];
  const u: Vec2 = [(g1[0] - g0[0]) / gap, (g1[1] - g0[1]) / gap];
  const n: Vec2 = [-u[1], u[0]];
  const win = Math.max(
    ...[0, -t / 2, t / 2].map((v) =>
      lineCov(ink, [g0[0] + n[0] * v, g0[1] + n[1] * v], [g1[0] + n[0] * v, g1[1] + n[1] * v], 24, 1),
    ),
  );
  let best: [number, 'left' | 'right' | null] = [0, null];
  for (const [hinge, toward, sw] of [
    [g0, u, 'left'],
    [g1, [-u[0], -u[1]], 'right'],
  ] as const) {
    for (const sgn of [1, -1]) {
      const c: Vec2 = [hinge[0] + (n[0] * sgn * t) / 2, hinge[1] + (n[1] * sgn * t) / 2];
      let arc = 0;
      for (let k = 0; k < 16; k++) {
        const th = ((15 + (60 * k) / 15) * Math.PI) / 180;
        arc += inkNear(
          ink,
          c[0] + (Math.cos(th) * n[0] * sgn + Math.sin(th) * toward[0]) * gap,
          c[1] + (Math.cos(th) * n[1] * sgn + Math.sin(th) * toward[1]) * gap,
          2,
        );
      }
      arc /= 16;
      const leaf = lineCov(ink, c, [c[0] + n[0] * sgn * gap, c[1] + n[1] * sgn * gap], 24, 2, 0.3, 0.9);
      const sc = 0.6 * arc + 0.4 * leaf;
      if (sc > best[0]) best = [sc, sw];
    }
  }
  if (win >= 0.6 && win >= best[0]) return ['window', 0.5 + 0.4 * win, null];
  if (best[0] >= 0.5) return ['door', 0.5 + 0.45 * best[0], best[1]];
  return ['none', 0.35, null];
}

/** 開口候選：共線牆段之間的缺口；牆的自由端到前方垂直牆之間的缺口 */
function findOpenings(segs: Seg[], ink: Gray, mask: Gray, range: [number, number]): Op[] {
  const ops: Op[] = [];
  const seen = new Set<string>();
  segs.forEach((p, i) => {
    const L = len(p);
    const u: Vec2 = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L];
    segs.forEach((q, j) => {
      if (i === j || seen.has(`${j},${i}`) || angleDiff(p, q) > 3) return;
      const [t0, d0] = projectOn(p, q.a);
      const [t1, d1] = projectOn(p, q.b);
      if (Math.max(d0, d1) > Math.max(p.thickness, q.thickness)) return;
      const qs = Math.min(t0, t1);
      const gap = qs - L;
      if (gap < range[0] || gap > range[1]) return;
      const g1: Vec2 = [p.a[0] + u[0] * qs, p.a[1] + u[1] * qs];
      const [kind, conf, swing] = classifyGap(ink, mask, p.b, g1, p.thickness);
      seen.add(`${i},${j}`);
      if (kind === 'window' || kind === 'door')
        ops.push({ type: kind, p0: p.b, p1: g1, i, j, swing, confidence: conf });
      else if (kind === 'wall') ops.push({ type: 'wall', p0: p.b, p1: g1, i, j });
      else ops.push({ type: 'gap', p0: p.b, p1: g1, i, j: null, end: null });
    });
    for (const [end, sign] of [
      ['a', -1],
      ['b', 1],
    ] as const) {
      const pt = p[end];
      const d: Vec2 = [u[0] * sign, u[1] * sign];
      let best: [number, number] | null = null;
      segs.forEach((o, k) => {
        if (k === i || angleDiff(p, o) < 60) return;
        const [to] = projectOn(o, pt);
        const Lo = len(o);
        if (to < -o.thickness || to > Lo + o.thickness) return;
        const on: Vec2 = [-(o.b[1] - o.a[1]) / Lo, (o.b[0] - o.a[0]) / Lo];
        const side = (pt[0] - o.a[0]) * on[0] + (pt[1] - o.a[1]) * on[1];
        const speed = -(d[0] * on[0] + d[1] * on[1]) * (side > 0 ? 1 : -1);
        if (speed <= 0.5) return;
        const dd = Math.abs(side) / speed - o.thickness / 2;
        if (dd >= range[0] && dd <= range[1] && (!best || dd < best[0])) best = [dd, k];
      });
      if (!best) continue;
      const dd = (best as [number, number])[0];
      const g1: Vec2 = [pt[0] + d[0] * dd, pt[1] + d[1] * dd];
      const [kind, conf, sw] = classifyGap(ink, mask, pt, g1, p.thickness);
      if (dd > p.thickness * 12 || conf < 0.78 || (kind !== 'door' && kind !== 'window')) {
        if (dd <= p.thickness * 12) ops.push({ type: 'gap', p0: pt, p1: g1, i, j: null, end: null });
        continue;
      }
      const swing = end === 'a' && sw ? (sw === 'left' ? 'right' : 'left') : sw;
      ops.push({ type: kind, p0: pt, p1: g1, i, j: null, end, swing, confidence: conf });
    }
  });
  return ops;
}

/** 雙線（空心）牆的窗：牆中心線上連續的墨跡 */
function hollowWindows(segs: Seg[], ink: Gray, minLen: number): Op[] {
  const ops: Op[] = [];
  segs.forEach((s, i) => {
    const L = len(s);
    const n = Math.max(8, Math.round(L));
    const at = (k: number): Vec2 => [
      s.a[0] + ((s.b[0] - s.a[0]) * k) / (n - 1),
      s.a[1] + ((s.b[1] - s.a[1]) * k) / (n - 1),
    ];
    let start: number | null = null;
    for (let k = 0; k <= n; k++) {
      const hit = k < n && inkNear(ink, at(k)[0], at(k)[1], 0);
      if (hit && start === null) start = k;
      else if (!hit && start !== null) {
        const runL = ((k - start) / n) * L;
        if (runL >= minLen && start > 0 && k < n)
          ops.push({ type: 'window', p0: at(start), p1: at(k - 1), i, j: i, swing: null, confidence: 0.7 });
        start = null;
      }
    }
  });
  return ops;
}

/** 開口兩側的牆段合併為一道牆；自由端門窗 → 把牆延伸到前方牆 */
function bridge(input: Seg[], ops: Op[]): [Seg[], Op[]] {
  const segs = input.map((s) => ({ ...s, a: [...s.a] as Vec2, b: [...s.b] as Vec2 }));
  for (const o of ops) {
    if (o.type === 'gap' || o.i === undefined) continue;
    if (o.j === null || o.j === undefined) {
      const s = segs[o.i];
      if (o.end === 'b') s.b = o.p1;
      else if (o.end === 'a') s.a = o.p1;
    }
  }
  const parent = segs.map((_, k) => k);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const o of ops)
    if (o.i !== undefined && o.j !== null && o.j !== undefined && o.j !== o.i) parent[find(o.i)] = find(o.j);
  const groups = new Map<number, Seg[]>();
  segs.forEach((s, k) => groups.set(find(k), [...(groups.get(find(k)) ?? []), s]));
  const merged: Seg[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      merged.push(g[0]);
      continue;
    }
    const base = g.reduce((a, b) => (len(b) > len(a) ? b : a));
    const L = len(base);
    const u: Vec2 = [(base.b[0] - base.a[0]) / L, (base.b[1] - base.a[1]) / L];
    const ts = g
      .flatMap((s) => [s.a, s.b])
      .map((pt) => (pt[0] - base.a[0]) * u[0] + (pt[1] - base.a[1]) * u[1]);
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    merged.push(
      seg(
        [base.a[0] + u[0] * lo, base.a[1] + u[1] * lo],
        [base.a[0] + u[0] * hi, base.a[1] + u[1] * hi],
        median(g.map((s) => s.thickness)),
        g.reduce((a, s) => a + s.confidence, 0) / g.length,
      ),
    );
  }
  return [merged, ops.filter((o) => o.type !== 'wall')];
}

/** 外框四邊上的共線牆段合併成連續外牆 */
function closeEnvelope(segs: Seg[], tPx: number): Seg[] {
  if (!segs.length) return segs;
  const xs = segs.flatMap((s) => [s.a[0], s.b[0]]);
  const ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: Seg[] = [];
  const groups: Record<'L' | 'R' | 'T' | 'B', Seg[]> = { L: [], R: [], T: [], B: [] };
  for (const s of segs) {
    const tol = Math.max(s.thickness, tPx) * 1.5;
    const vert = Math.abs(s.a[0] - s.b[0]) < 1;
    const horiz = Math.abs(s.a[1] - s.b[1]) < 1;
    if (vert && Math.abs(s.a[0] - x0) <= tol) groups.L.push(s);
    else if (vert && Math.abs(s.a[0] - x1) <= tol) groups.R.push(s);
    else if (horiz && Math.abs(s.a[1] - y0) <= tol) groups.T.push(s);
    else if (horiz && Math.abs(s.a[1] - y1) <= tol) groups.B.push(s);
    else out.push(s);
  }
  for (const [side, g] of Object.entries(groups) as ['L' | 'R' | 'T' | 'B', Seg[]][]) {
    if (!g.length) continue;
    const tot = Math.max(
      1e-9,
      g.reduce((a, s) => a + len(s), 0),
    );
    const th = g.reduce((a, s) => a + s.thickness * len(s), 0) / tot;
    const cf = g.reduce((a, s) => a + s.confidence * len(s), 0) / tot;
    if (side === 'L' || side === 'R') {
      const x = g.reduce((a, s) => a + s.a[0] * len(s), 0) / tot;
      const lo = Math.min(...g.map((s) => Math.min(s.a[1], s.b[1])));
      const hi = Math.max(...g.map((s) => Math.max(s.a[1], s.b[1])));
      out.push(seg([x, lo], [x, hi], th, cf));
    } else {
      const y = g.reduce((a, s) => a + s.a[1] * len(s), 0) / tot;
      const lo = Math.min(...g.map((s) => Math.min(s.a[0], s.b[0])));
      const hi = Math.max(...g.map((s) => Math.max(s.a[0], s.b[0])));
      out.push(seg([lo, y], [hi, y], th, cf));
    }
  }
  return out;
}

/** 封閉區域 → 房間多邊形：牆 mask ＋ 把開口封起來，取不碰影像邊界的空白連通區 */
function findRooms(mask: Gray, ops: Op[], tPx: number): { poly: Vec2[]; conf: number; area: number }[] {
  const closed = clone(mask);
  for (const o of ops) drawLine(closed, o.p0, o.p1, Math.max(2, Math.round(tPx)));
  const free = not(dilate(closed, 3));
  const { labels, stats } = components(free, 4);
  const { width: w, height: h } = mask;
  // 最小房間：約 (8 倍牆厚)²（排除牆間細縫、管道間）
  const minArea = (tPx * 8) ** 2;
  const firstPixel = new Int32Array(stats.length).fill(-1);
  for (let i = 0; i < labels.length; i++)
    if (labels[i] && firstPixel[labels[i]] < 0) firstPixel[labels[i]] = i;
  const rooms: { poly: Vec2[]; conf: number; area: number }[] = [];
  for (let i = 1; i < stats.length; i++) {
    const s = stats[i];
    if (s.x === 0 || s.y === 0 || s.x + s.w >= w || s.y + s.h >= h || s.area < minArea) continue;
    const contour = traceContour(labels, w, h, i, firstPixel[i]);
    const poly = simplify(contour, Math.max(2, tPx * 0.8)).map(([x, y]) => [x + 0.5, y + 0.5] as Vec2);
    if (poly.length < 3) continue;
    const solidity = s.area / Math.max(1, s.w * s.h);
    rooms.push({ poly, conf: Math.min(0.95, 0.4 + 0.55 * solidity), area: s.area });
  }
  return rooms;
}

/** 以長度加權的牆厚中位數（尺寸線、家具外框這類短細線不會拉低主牆厚） */
export function dominantThickness(segs: Seg[]): number {
  const xs = segs.map((s) => ({ t: s.thickness, w: len(s) })).sort((a, b) => a.t - b.t);
  const tot = xs.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of xs) {
    acc += x.w;
    if (acc >= tot / 2) return x.t;
  }
  return xs.at(-1)?.t ?? 0;
}

/**
 * 移除比主牆薄很多的筆畫：尺寸線、家具外框、填色邊界被自適應二值化加粗後（4–6 px）
 * 能通過 segmentWalls 的 open(4)，會被當成牆、圍成假房間——外框的尺寸線更會讓真正的外牆變成內牆。
 * 以主牆厚 45% 的方形核做 opening：比它細的筆畫消失，主牆與一般隔間牆（約主牆一半厚）保留，轉角形狀不變。
 */
export function dropThinStrokes(mask: Gray): Gray {
  const { segs } = vectorize(mask);
  if (!segs.length) return mask;
  const T = dominantThickness(segs);
  const k = Math.floor(T * 0.45);
  if (k < 3 || !segs.some((s) => s.thickness < k)) return mask;
  const cleaned = open(mask, k);
  return count(cleaned) > 0 ? cleaned : mask;
}

// ── 主流程 ────────────────────────────────────────────────────────

export function recognizeRaster(img: Gray, opts: RasterOptions = {}): PlanResult {
  if (Math.max(img.width, img.height) > MAX_SIDE)
    throw new PlanParseError('UPLOAD_REJECTED', `影像長邊超過 ${MAX_SIDE}px`);
  const seg0 = segmentWalls(img);
  const { ink, conf: segConf, hollow } = seg0;
  const mask = dropThinStrokes(seg0.mask);
  const warnings: PlanResult['warnings'] = [];
  const first = vectorize(mask);
  const t0 = first.t;
  const symbols = detectSymbols(ink, mask, t0);
  // 找到的門窗缺口補回牆 mask → 牆向量化成連續的一道
  const filled = clone(mask);
  for (const o of symbols) drawLine(filled, o.p0, o.p1, Math.max(2, Math.round(t0)));
  const vec = vectorize(filled);
  let segs = vec.segs;
  const tPx = vec.t;
  if (!segs.length) throw new PlanParseError('PARSE_FAILED', '影像中找不到牆');
  if (vec.diagonal > 0.08)
    warnings.push({
      code: 'DIAGONAL_WALLS',
      message: '偵測到斜牆或曲線牆，瀏覽器辨識只處理水平／垂直牆，請在編輯器中補畫',
    });
  const hint = opts.scaleMmPerPx && opts.scaleMmPerPx > 0 ? opts.scaleMmPerPx : null;
  const range: [number, number] = hint ? [450 / hint, 2600 / hint] : [tPx * 3, tPx * 28];
  let ops = findOpenings(segs, ink, filled, range);
  if (hollow) ops = [...ops, ...hollowWindows(segs, ink, range[0])];
  [segs, ops] = bridge(segs, ops);
  segs = snapEndpoints(segs.filter((s) => len(s) >= tPx * 2.5));
  const rooms = findRooms(filled, ops, tPx);
  let doorsWins = ops.filter((o) => o.type === 'door' || o.type === 'window');
  const center = (o: Op): Vec2 => [(o.p0[0] + o.p1[0]) / 2, (o.p0[1] + o.p1[1]) / 2];
  const overlaps = (a: Op, b: Op) =>
    dist(center(a), center(b)) < Math.max(dist(a.p0, a.p1), dist(b.p0, b.p1)) * 0.6;
  doorsWins = [...symbols, ...doorsWins.filter((o) => !symbols.some((s) => overlaps(o, s)))];
  const dedup: Op[] = [];
  for (const o of [...doorsWins].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)))
    if (!dedup.some((d) => overlaps(o, d))) dedup.push(o);
  segs = snapEndpoints(closeEnvelope(segs, tPx));

  // 尺度：沒有 OCR → 使用者校正；以門寬中位數（850 mm）預填建議值
  const mmpp = hint;
  const doors = dedup.filter((o) => o.type === 'door').map((o) => dist(o.p0, o.p1));
  let suggested: number | null = null;
  if (!mmpp) {
    if (doors.length) suggested = Math.round((TYPICAL_DOOR_MM / median(doors)) * 1000) / 1000;
    warnings.push({ code: 'SCALE_UNKNOWN', message: '無法自動判定尺度，請以兩點與實際長度校正' });
  }
  const xs = segs.flatMap((s) => [s.a[0], s.b[0]]);
  const ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
  const ox = Math.min(...xs);
  const oy = Math.min(...ys);
  const k = mmpp ?? 1;
  const T = (p: Vec2): Vec2 => [(p[0] - ox) * k, (p[1] - oy) * k];
  const rnd = mmpp ? (v: number) => Math.round(v) : (v: number) => Math.round(v * 100) / 100;
  const R = (p: Vec2): Vec2 => [rnd(p[0]), rnd(p[1])];
  const walls = segs.map((s, i) => ({
    id: `w_${i}`,
    a: R(T(s.a)),
    b: R(T(s.b)),
    thickness: rnd(s.thickness * k),
    confidence: Math.round(Math.min(0.95, Math.min(s.confidence, 0.95) * (segConf / 0.72)) * 1000) / 1000,
  }));
  const openings: OpeningOut[] = [];
  for (const o of dedup) {
    let best: [number, number, number, number] | null = null;
    segs.forEach((s, wi) => {
      const [t0p, d0] = projectOn(s, o.p0);
      const [t1p, d1] = projectOn(s, o.p1);
      if (Math.max(d0, d1) <= s.thickness * 1.2 && (!best || d0 + d1 < best[0]))
        best = [d0 + d1, wi, Math.min(t0p, t1p), Math.abs(t1p - t0p)];
    });
    if (!best) continue;
    const [, wi, off, width] = best as [number, number, number, number];
    openings.push({
      id: `op_${openings.length}`,
      wallId: walls[wi].id,
      type: o.type as 'door' | 'window',
      offset: rnd(Math.max(0, off) * k),
      width: rnd(width * k),
      height: o.type === 'door' ? 2100 : 1200,
      sill: o.type === 'door' ? 0 : 900,
      swing: o.type === 'door' ? (o.swing ?? null) : null,
      confidence: Math.round(Math.min(0.95, o.confidence ?? 0.6) * 1000) / 1000,
    });
  }
  const roomOut: RoomOut[] = rooms.map((r) => ({
    polygon: r.poly.map((p) => R(T(p))),
    label: null,
    confidence: Math.round(r.conf * 1000) / 1000,
  }));
  return {
    source: 'raster',
    units: mmpp ? 'mm' : 'px',
    scale: {
      mmPerPx: mmpp,
      method: mmpp ? 'user' : 'unknown',
      confidence: mmpp ? 1 : 0,
      suggestedMmPerPx: suggested,
    },
    walls,
    openings,
    rooms: roomOut,
    labels: [],
    image: {
      width: img.width,
      height: img.height,
      rotationDeg: 0,
      originPx: [ox, oy],
      segmenter: 'browser-cv',
      wallThicknessPx: Math.round(tPx * 100) / 100,
    },
    warnings,
  };
}
