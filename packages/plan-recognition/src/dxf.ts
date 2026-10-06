import {
  angleDiff,
  dist,
  len,
  mergeCollinear,
  orthogonalSnap,
  projectOn,
  seg,
  snapEndpoints,
  type Seg,
} from './geom.js';
import { PlanParseError, type LabelOut, type OpeningOut, type PlanResult, type Vec2 } from './types.js';

/**
 * DXF 向量路線（瀏覽器版，移植自 services/cv-service/app/vector/dxf.py，06 §2）：
 * ASCII DXF 讀取（LINE、LWPOLYLINE、POLYLINE、ARC、TEXT、MTEXT、INSERT＋BLOCKS）→ 圖層啟發式 →
 * 雙線牆配對成中心線＋厚度 → 共線合併 → 門弧／窗線填補缺口成開口 → 端點吸附。
 * 單位由 $INSUNITS；缺失時 units='px'，前端必須校正（B6.5-3）。
 */
const WALL_RE = /(^|[^a-z])(a-)?wall|牆|墙/i;
const DOOR_RE = /door|門|门/i;
const WIN_RE = /window|(^|[^a-z])win([^a-z]|$)|glaz|窗/i;
const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };
export const MAX_ENTITIES = 500_000;

interface Line {
  a: Vec2;
  b: Vec2;
  layer: string;
}
interface Arc {
  c: Vec2;
  r: number;
  layer: string;
}
type Pair = [number, string];

/** 解析 group code／value 配對 */
function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    out.push([code, lines[i + 1].trimEnd()]);
  }
  return out;
}

interface Entity {
  type: string;
  g: Pair[];
}
const val = (e: Entity, code: number, d = '') => e.g.find((p) => p[0] === code)?.[1] ?? d;
const num = (e: Entity, code: number, d = 0) => {
  const v = Number(val(e, code, String(d)));
  return Number.isFinite(v) ? v : d;
};

/** 把 pairs 切成 section → entities */
function readDxf(text: string) {
  const ps = pairs(text);
  if (!ps.length) throw new PlanParseError('UPLOAD_REJECTED', '不是有效的 ASCII DXF');
  const header: Record<string, Pair[]> = {};
  const blocks = new Map<string, { base: Vec2; ents: Entity[] }>();
  const model: Entity[] = [];
  let i = 0;
  const entitiesUntil = (stop: string[]): Entity[] => {
    const ents: Entity[] = [];
    let cur: Entity | null = null;
    while (i < ps.length) {
      const [c, v] = ps[i];
      if (c === 0) {
        if (stop.includes(v)) break;
        cur = { type: v, g: [] };
        ents.push(cur);
      } else cur?.g.push(ps[i]);
      i++;
    }
    return ents;
  };
  while (i < ps.length) {
    const [c, v] = ps[i];
    if (c === 0 && v === 'SECTION') {
      const name = ps[i + 1]?.[1];
      i += 2;
      if (name === 'HEADER') {
        let key = '';
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
          if (ps[i][0] === 9) {
            key = ps[i][1];
            header[key] = [];
          } else if (key) header[key]!.push(ps[i]);
          i++;
        }
      } else if (name === 'BLOCKS') {
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
          if (ps[i][0] === 0 && ps[i][1] === 'BLOCK') {
            const head: Entity = { type: 'BLOCK', g: [] };
            i++;
            while (i < ps.length && ps[i][0] !== 0) head.g.push(ps[i++]);
            const ents = entitiesUntil(['ENDBLK']);
            blocks.set(val(head, 2), { base: [num(head, 10), num(head, 20)], ents });
          } else i++;
        }
      } else if (name === 'ENTITIES') {
        model.push(...entitiesUntil(['ENDSEC']));
      } else {
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) i++;
      }
    }
    i++;
  }
  return { header, blocks, model };
}

/** 2D 仿射轉換（INSERT：縮放、旋轉、平移） */
type Xf = (p: Vec2) => Vec2;
const identity: Xf = (p) => p;

function collect(doc: ReturnType<typeof readDxf>) {
  const lines: Line[] = [];
  const arcs: Arc[] = [];
  const texts: [string, Vec2][] = [];
  let count = 0;
  const visit = (ents: Entity[], xf: Xf, scale: number, layerOverride: string | null, depth: number) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (++count > MAX_ENTITIES) throw new PlanParseError('UPLOAD_REJECTED', 'DXF 實體數超過上限');
      const own = val(e, 8, '0');
      const layer = layerOverride && own === '0' ? layerOverride : own;
      switch (e.type) {
        case 'LINE':
          lines.push({ a: xf([num(e, 10), num(e, 20)]), b: xf([num(e, 11), num(e, 21)]), layer });
          break;
        case 'LWPOLYLINE': {
          const xs = e.g.filter((p) => p[0] === 10).map((p) => Number(p[1]));
          const ys = e.g.filter((p) => p[0] === 20).map((p) => Number(p[1]));
          const pts: Vec2[] = xs.map((x, n) => xf([x, ys[n] ?? 0]));
          if (num(e, 70) & 1 && pts.length > 2) pts.push(pts[0]);
          for (let n = 1; n < pts.length; n++) lines.push({ a: pts[n - 1], b: pts[n], layer });
          break;
        }
        case 'POLYLINE': {
          const pts: Vec2[] = [];
          while (k + 1 < ents.length && ents[k + 1].type === 'VERTEX') {
            k++;
            pts.push(xf([num(ents[k], 10), num(ents[k], 20)]));
          }
          if (ents[k + 1]?.type === 'SEQEND') k++;
          if (num(e, 70) & 1 && pts.length > 2) pts.push(pts[0]);
          for (let n = 1; n < pts.length; n++) lines.push({ a: pts[n - 1], b: pts[n], layer });
          break;
        }
        case 'ARC':
          arcs.push({ c: xf([num(e, 10), num(e, 20)]), r: num(e, 40) * scale, layer });
          break;
        case 'TEXT':
        case 'MTEXT': {
          const raw =
            e.type === 'TEXT'
              ? val(e, 1)
              : [...e.g.filter((p) => p[0] === 3).map((p) => p[1]), val(e, 1)].join('');
          const txt = raw
            .replace(/\\P/g, ' ')
            .replace(/\\[A-Za-z][^;]*;/g, '')
            .replace(/[{}]/g, '')
            .trim();
          if (txt) texts.push([txt, xf([num(e, 10), num(e, 20)])]);
          break;
        }
        case 'INSERT': {
          const b = doc.blocks.get(val(e, 2));
          if (!b || depth > 8) break;
          const sx = num(e, 41, 1);
          const sy = num(e, 42, 1);
          const rot = (num(e, 50) * Math.PI) / 180;
          const ins: Vec2 = [num(e, 10), num(e, 20)];
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const inner: Xf = ([x, y]) => {
            const lx = (x - b.base[0]) * sx;
            const ly = (y - b.base[1]) * sy;
            return xf([ins[0] + lx * c - ly * s, ins[1] + lx * s + ly * c]);
          };
          visit(b.ents, inner, scale * Math.abs(sx), layer, depth + 1);
          break;
        }
      }
    }
  };
  visit(doc.model, identity, 1, null, 0);
  return { lines, arcs, texts };
}

/** 雙線牆：平行、間距在 [tmin, tmax]、投影重疊 ≥ 50% → 中心線＋厚度 */
function pairWalls(lines: Line[], tmin: number, tmax: number): [Seg[], Line[]] {
  const segs: Seg[] = [];
  const used = new Set<string>();
  const L = (l: Line) => dist(l.a, l.b);
  const order = lines.map((_, i) => i).sort((x, y) => L(lines[y]) - L(lines[x]));
  for (const i of order) {
    const p = lines[i];
    const Lp = L(p);
    if (Lp < tmin) continue;
    const u: Vec2 = [(p.b[0] - p.a[0]) / Lp, (p.b[1] - p.a[1]) / Lp];
    let best: [number, number, number, number] | null = null;
    lines.forEach((q, j) => {
      const Lq = L(q);
      if (j === i || Lq < tmin) return;
      if (angleDiff(seg(p.a, p.b, 0), seg(q.a, q.b, 0)) > 1) return;
      const d1 = (q.a[0] - p.a[0]) * -u[1] + (q.a[1] - p.a[1]) * u[0];
      const d2 = (q.b[0] - p.a[0]) * -u[1] + (q.b[1] - p.a[1]) * u[0];
      if (Math.abs(d1 - d2) > tmin * 0.2 || Math.abs(d1) < tmin || Math.abs(d1) > tmax) return;
      const t = (pt: Vec2) => (pt[0] - p.a[0]) * u[0] + (pt[1] - p.a[1]) * u[1];
      const [q0, q1] = [t(q.a), t(q.b)].sort((x, y) => x - y) as [number, number];
      const lo = Math.max(0, q0);
      const hi = Math.min(Lp, q1);
      if (hi - lo < 0.5 * Math.min(Lp, Lq)) return;
      if (!best || Math.abs(d1) < Math.abs(best[0])) best = [d1, lo, hi, j];
    });
    if (!best) continue;
    const [d, lo, hi, j] = best as [number, number, number, number];
    const key = [i, j].sort((x, y) => x - y).join(',');
    if (used.has(key)) continue;
    used.add(key);
    const n: Vec2 = [-u[1], u[0]];
    const off = d / 2;
    segs.push(
      seg(
        [p.a[0] + u[0] * lo + n[0] * off, p.a[1] + u[1] * lo + n[1] * off],
        [p.a[0] + u[0] * hi + n[0] * off, p.a[1] + u[1] * hi + n[1] * off],
        Math.abs(d),
        0.95,
      ),
    );
  }
  const paired = new Set([...used].flatMap((k) => k.split(',').map(Number)));
  return [segs, lines.filter((l, k) => !paired.has(k) && L(l) >= tmin)];
}

interface RawOpening {
  type: 'door' | 'window';
  p0: Vec2;
  p1: Vec2;
  swing: 'left' | 'right' | 'none';
}

/** 共線牆段之間若有門弧（半徑 ≈ 缺口）或窗線 → 合併成一道牆＋開口 */
function bridgeOpenings(segs: Seg[], arcs: Arc[], winLines: Line[], unit: number): [Seg[], RawOpening[]] {
  const openings: RawOpening[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const p = segs[i];
        const q = segs[j];
        if (angleDiff(p, q) > 2) continue;
        const [t0, d0] = projectOn(p, q.a);
        const [t1, d1] = projectOn(p, q.b);
        if (Math.max(d0, d1) > Math.max(p.thickness, q.thickness) * 0.3) continue;
        const [qs, qe] = [t0, t1].sort((x, y) => x - y) as [number, number];
        const Lp = len(p);
        const gap = qs - Lp;
        if (gap <= p.thickness * 0.5 || gap > 3000 * unit) continue;
        const u: Vec2 = [(p.b[0] - p.a[0]) / Lp, (p.b[1] - p.a[1]) / Lp];
        const g0 = p.b;
        const g1: Vec2 = [p.a[0] + u[0] * qs, p.a[1] + u[1] * qs];
        let kind: 'door' | 'window' | null = null;
        let swing: RawOpening['swing'] = 'none';
        const tol = Math.max(p.thickness, q.thickness) * 1.2;
        for (const arc of arcs) {
          const near0 = dist(arc.c, g0) - p.thickness / 2;
          const near1 = dist(arc.c, g1) - p.thickness / 2;
          const [, da] = projectOn(p, arc.c);
          if (da > tol + p.thickness) continue;
          if (Math.abs(arc.r - gap) <= 0.18 * gap && Math.min(near0, near1) <= tol) {
            kind = 'door';
            swing = near0 <= near1 ? 'left' : 'right';
            break;
          }
        }
        if (!kind)
          for (const wl of winLines) {
            const m: Vec2 = [(wl.a[0] + wl.b[0]) / 2, (wl.a[1] + wl.b[1]) / 2];
            const [tm, dm] = projectOn(p, m);
            if (Lp < tm && tm < qs && dm <= p.thickness && dist(wl.a, wl.b) >= gap * 0.6) {
              kind = 'window';
              break;
            }
          }
        if (!kind) continue;
        const e = Math.max(qe, qs);
        segs[i] = seg(
          p.a,
          [p.a[0] + u[0] * e, p.a[1] + u[1] * e],
          Math.max(p.thickness, q.thickness),
          Math.min(p.confidence, q.confidence),
        );
        openings.push({ type: kind, p0: g0, p1: g1, swing });
        segs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return [segs, openings];
}

export function recognizeDxf(text: string, opts: { orthogonal?: boolean } = {}): PlanResult {
  const doc = readDxf(text);
  const units = Number(doc.header.$INSUNITS?.find((p) => p[0] === 70)?.[1] ?? 0) || 0;
  const mm = UNIT_MM[units];
  const warnings: PlanResult['warnings'] = [];
  const raw = collect(doc);
  if (!raw.lines.length) throw new PlanParseError('PARSE_FAILED', 'DXF 中沒有線段');
  const k = mm ?? 1;
  // DXF y 朝上 → 平面 z 朝下（與 2D 編輯器一致）
  const S = (p: Vec2): Vec2 => [p[0] * k, -p[1] * k];
  const lines = raw.lines.map((l) => ({ a: S(l.a), b: S(l.b), layer: l.layer }));
  const arcs = raw.arcs.map((a) => ({ c: S(a.c), r: a.r * k, layer: a.layer }));
  const texts = raw.texts.map(([t, p]) => [t, S(p)] as [string, Vec2]);
  const xs = lines.flatMap((l) => [l.a[0], l.b[0]]);
  const ys = lines.flatMap((l) => [l.a[1], l.b[1]]);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const unit = mm ? 1 : extent / 10000;
  const [tmin, tmax] = mm ? [40, 450] : [extent * 0.003, extent * 0.05];

  let wallLines = lines.filter((l) => WALL_RE.test(l.layer));
  const doorArcs = arcs.filter((a) => DOOR_RE.test(a.layer));
  const arcsForDoors = doorArcs.length
    ? doorArcs
    : arcs.filter((a) => a.r >= 450 * unit && a.r <= 1400 * unit);
  const winLines = lines.filter((l) => WIN_RE.test(l.layer));
  if (!wallLines.length) {
    warnings.push({ code: 'NO_WALL_LAYER', message: '找不到牆圖層，改用所有非門窗線段（信心較低）' });
    wallLines = lines.filter((l) => !DOOR_RE.test(l.layer) && !WIN_RE.test(l.layer));
  }
  const [paired, singles] = pairWalls(wallLines, tmin, tmax);
  let segs = [...paired, ...singles.map((s) => seg(s.a, s.b, 120 * unit, 0.55, { single: true }))];
  if (opts.orthogonal !== false) segs = orthogonalSnap(segs);
  segs = mergeCollinear(segs, tmin, tmin * 0.8);
  const [bridged, ops] = bridgeOpenings(segs, arcsForDoors, winLines, unit);
  segs = snapEndpoints(bridged).filter((s) => len(s) >= 100 * unit);

  const R = (p: Vec2): Vec2 =>
    mm
      ? [Math.round(p[0]), Math.round(p[1])]
      : [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
  const Rt = (v: number) => (mm ? Math.round(v) : Math.round(v * 1000) / 1000);
  const walls = segs.map((s, i) => ({
    id: `w_${i}`,
    a: R(s.a),
    b: R(s.b),
    thickness: Rt(s.thickness),
    confidence: Math.round(s.confidence * 1000) / 1000,
  }));
  const openings: OpeningOut[] = [];
  for (const o of ops) {
    let best: [number, number, number, number] | null = null;
    segs.forEach((s, wi) => {
      const [t0, d0] = projectOn(s, o.p0);
      const [t1, d1] = projectOn(s, o.p1);
      if (Math.max(d0, d1) <= s.thickness && (!best || d0 + d1 < best[0]))
        best = [d0 + d1, wi, Math.min(t0, t1), Math.abs(t1 - t0)];
    });
    if (!best) continue;
    const [, wi, off, width] = best as [number, number, number, number];
    openings.push({
      id: `op_${openings.length}`,
      wallId: walls[wi].id,
      type: o.type,
      offset: Rt(off),
      width: Rt(width),
      height: o.type === 'door' ? 2100 : 1200,
      sill: o.type === 'door' ? 0 : 900,
      swing: o.type === 'door' ? o.swing : null,
      confidence: o.type === 'door' ? 0.9 : 0.85,
    });
  }
  if (!mm)
    warnings.push({
      code: 'SCALE_UNKNOWN',
      message: 'DXF 未設定單位（$INSUNITS），請以兩點與實際長度校正尺度',
    });
  const labels: LabelOut[] = texts.filter(([t]) => t).map(([t, p]) => ({ text: t, position: R(p) }));
  return {
    source: 'vector',
    units: mm ? 'mm' : 'px',
    scale: { mmPerPx: mm ? 1 : null, method: mm ? 'dxf_units' : 'unknown', confidence: mm ? 1 : 0 },
    walls,
    openings,
    rooms: [],
    labels,
    image: null,
    warnings,
  };
}
