import { objectDims, type Catalog } from '@interiorai/catalog';
import { closestOnSegment, detectRooms, signedArea, type Vec2 } from '@interiorai/core-geometry';
import type { Level, SceneObject } from '@interiorai/scene-schema';

type Placement = Omit<SceneObject, 'id'>;

/**
 * 廚房／衛浴自動佈局（FE-AST-08）：沿牆連續下櫃（寬度以參數補滿）＋吊櫃＋抽油煙機，
 * I／L／U 型（L、U 在轉角處讓出下櫃深度避免重疊），避開門口，窗下若窗台 < 900 不放下櫃／窗前不放吊櫃；
 * 水槽優先置於窗下、冰箱在動線末端、爐台與水槽保持距離。純函式，回傳 placements。
 */
export type KitchenShape = 'I' | 'L' | 'U';
const DEPTH = 600;
const CLEAR = 150;
const CORNER = 730;

interface Edge {
  p: Vec2;
  q: Vec2;
  L: number;
  e: Vec2;
  n: Vec2;
  blocked: [number, number][];
  windows: [number, number][];
}

function roomEdges(level: Level, roomId: string): Edge[] | null {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const d = detectRooms(level).rooms.find((x) => x.key === [...room.wallIds].sort().join('|'));
  if (!d) return null;
  const poly = d.floor;
  const ccw = signedArea(poly) > 0;
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const e: Vec2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const n: Vec2 = ccw ? [-e[1], e[0]] : [e[1], -e[0]];
    const along = (v: Vec2) => (v[0] - p[0]) * e[0] + (v[1] - p[1]) * e[1];
    const blocked: [number, number][] = [];
    const windows: [number, number][] = [];
    const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    for (const w of level.walls) {
      const c = closestOnSegment(mid, w.a as Vec2, w.b as Vec2);
      if (Math.abs(c.distance - w.thickness / 2) > 5) continue;
      const WL = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (const o of level.openings.filter((x) => x.wallId === w.id)) {
        const at = (off: number): Vec2 => [
          w.a[0] + ((w.b[0] - w.a[0]) * off) / WL,
          w.a[1] + ((w.b[1] - w.a[1]) * off) / WL,
        ];
        const [u0, u1] = [along(at(o.offset)), along(at(o.offset + o.width))].sort((x, y) => x - y) as [
          number,
          number,
        ];
        if (u1 < 0 || u0 > L) continue;
        if (o.type !== 'window' || (o.sill ?? 0) < 900)
          blocked.push([u0 - (o.type === 'window' ? 0 : CLEAR), u1 + (o.type === 'window' ? 0 : CLEAR)]);
        else windows.push([u0, u1]);
      }
    }
    return { p, q, L, e, n, blocked, windows };
  });
  // 門前淨空區（門寬＋兩側 150、深 900）：投影到其他牆邊，下櫃深度範圍內重疊者也封鎖
  const zones: Vec2[][] = [];
  for (const ed of edges)
    for (const [u0, u1] of ed.blocked) {
      const at = (u: number, k: number): Vec2 => [
        ed.p[0] + ed.e[0] * u + ed.n[0] * k,
        ed.p[1] + ed.e[1] * u + ed.n[1] * k,
      ];
      zones.push([at(u0, 0), at(u1, 0), at(u1, 900), at(u0, 900)]);
    }
  for (const ed of edges)
    for (const z of zones) {
      const al = z.map((v) => (v[0] - ed.p[0]) * ed.e[0] + (v[1] - ed.p[1]) * ed.e[1]);
      const nd = z.map((v) => (v[0] - ed.p[0]) * ed.n[0] + (v[1] - ed.p[1]) * ed.n[1]);
      if (Math.min(...nd) < DEPTH + 10 && Math.max(...nd) > 1)
        ed.blocked.push([Math.min(...al), Math.max(...al)]);
    }
  return edges;
}

/** 一段可用區間（沿邊的 [u0, u1]），扣掉門口與低窗 */
function freeSpans(edge: Edge, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let u = start;
  for (const [b0, b1] of [...edge.blocked].sort((a, b) => a[0] - b[0])) {
    if (b1 <= u || b0 >= end) continue;
    if (b0 - u >= 300) out.push([u, b0]);
    u = Math.max(u, b1);
  }
  if (end - u >= 300) out.push([u, end]);
  return out;
}

export function planKitchen(
  level: Level,
  catalog: Catalog,
  roomId: string,
  shape: KitchenShape = 'L',
): Placement[] {
  const edges = roomEdges(level, roomId);
  if (!edges) return [];
  const usable = (ed: Edge) => freeSpans(ed, 0, ed.L).reduce((s, [a, b]) => s + b - a, 0);
  // 主牆＝可用長度最長；L／U 取相鄰（共用轉角）的牆
  const idx = edges.map((e, i) => ({ e, i, u: usable(e) })).sort((a, b) => b.u - a.u)[0];
  if (!idx || idx.u < 1200) return [];
  const N = edges.length;
  const chosen: number[] = [idx.i];
  const next = (i: number) => (i + 1) % N;
  const prev = (i: number) => (i - 1 + N) % N;
  if (shape !== 'I') {
    const a = usable(edges[next(idx.i)]!);
    const b = usable(edges[prev(idx.i)]!);
    chosen.push(a >= b ? next(idx.i) : prev(idx.i));
    if (shape === 'U') chosen.push(a >= b ? prev(idx.i) : next(idx.i));
  }
  // 各段範圍：轉角處後段讓出前段的下櫃深度
  const runs = chosen.map((i) => {
    const ed = edges[i]!;
    let start = 0;
    let end = ed.L;
    // 轉角讓位：主牆下櫃深度＋離牆 10 mm＋冰箱可能較深（700）→ 取 CORNER
    if (chosen.includes(prev(i)) && i !== idx.i) start = CORNER;
    if (chosen.includes(next(i)) && i !== idx.i) end = ed.L - CORNER;
    if (i === idx.i && shape === 'U') {
      // 主牆在 U 的中間：兩端都被側牆佔用轉角 → 主牆全長
    }
    return { i, ed, spans: freeSpans(ed, start, end) };
  });
  const get = (id: string) => catalog.get(id);
  const out: Placement[] = [];
  const rotOf = (ed: Edge) => Math.atan2(ed.n[0], ed.n[1]);
  const put = (ed: Edge, id: string, u0: number, w: number, y = 0, depthFor?: number) => {
    const e = get(id);
    if (!e) return;
    const dep = depthFor ?? objectDims(e).d;
    const um = u0 + w / 2;
    const x = ed.p[0] + ed.e[0] * um + ed.n[0] * (dep / 2 + 10);
    const z = ed.p[1] + ed.e[1] * um + ed.n[1] * (dep / 2 + 10);
    const base = objectDims(e).w;
    out.push({
      catalogId: id,
      position: [Math.round(x), Math.round(y), Math.round(z)],
      rotationY: rotOf(ed),
      scale: [1, 1, 1],
      ...(Math.round(w) !== base ? { params: { w: Math.round(w) } } : {}),
    });
  };
  // 主要設備位置：水槽＝窗下（沒有窗則主牆中段）、冰箱＝最後一段末端、爐台＝與水槽不同段或相距 ≥ 600
  type Slot = { run: number; u0: number; w: number; id: string };
  const fixed: Slot[] = [];
  const fits = (r: number, u0: number, w: number) =>
    runs[r]!.spans.some(([a, b]) => u0 >= a - 1 && u0 + w <= b + 1) &&
    !fixed.some((f) => f.run === r && u0 < f.u0 + f.w && f.u0 < u0 + w);
  const tryFix = (id: string, w: number, cands: { r: number; u0: number }[]) => {
    for (const c of cands) if (fits(c.r, c.u0, w)) return (fixed.push({ run: c.r, u0: c.u0, w, id }), true);
    return false;
  };
  const allSpans = runs.flatMap((r, ri) => r.spans.map(([a, b]) => ({ r: ri, a, b })));
  const lastRun = runs.length - 1;
  const lastSpan = runs[lastRun]!.spans.at(-1);
  if (lastSpan)
    tryFix('fridge_a', 700, [
      { r: lastRun, u0: lastSpan[1] - 700 },
      { r: lastRun, u0: lastSpan[0] },
    ]);
  const winCands = runs.flatMap((r, ri) => r.ed.windows.map(([a, b]) => ({ r: ri, u0: (a + b) / 2 - 450 })));
  const mid = allSpans.map((s) => ({ r: s.r, u0: Math.round((s.a + s.b) / 2 - 450) }));
  tryFix('sink_900', 900, [...winCands, ...mid, ...allSpans.map((s) => ({ r: s.r, u0: s.a }))]);
  const sink = fixed.find((f) => f.id === 'sink_900');
  const stoveCands = allSpans
    .flatMap((s) =>
      [s.a + 600, (s.a + s.b) / 2 - 300, s.b - 1200, s.a].map((u0) => ({ r: s.r, u0: Math.round(u0) })),
    )
    .sort((x, y) => {
      const far = (c: { r: number; u0: number }) =>
        sink && c.r === sink.run ? -Math.abs(c.u0 - sink.u0) : 5000;
      return far(y) - far(x);
    });
  // 爐台與水槽之間至少留 300 mm 工作檯面；做不到時退而求其次（任何可放的位置）
  const okGap = (c: { r: number; u0: number }) =>
    !sink || c.r !== sink.run || c.u0 >= sink.u0 + sink.w + 300 || c.u0 + 600 <= sink.u0 - 300;
  const scan = allSpans.flatMap((sp) =>
    Array.from({ length: Math.max(0, Math.floor((sp.b - sp.a - 600) / 50)) + 1 }, (_, k) => ({
      r: sp.r,
      u0: sp.a + k * 50,
    })),
  );
  if (!tryFix('stove_600', 600, [...stoveCands, ...scan].filter(okGap))) tryFix('stove_600', 600, scan);
  // 其餘以下櫃補滿（每塊 300–900 mm）
  const bases: Slot[] = [];
  for (const s of allSpans) {
    const taken = fixed
      .filter((f) => f.run === s.r && f.u0 < s.b && f.u0 + f.w > s.a)
      .sort((x, y) => x.u0 - y.u0);
    let u = s.a;
    const gaps: [number, number][] = [];
    for (const f of taken) {
      if (f.u0 - u >= 1) gaps.push([u, f.u0]);
      u = Math.max(u, f.u0 + f.w);
    }
    if (s.b - u >= 1) gaps.push([u, s.b]);
    for (const [g0, g1] of gaps) {
      const len = g1 - g0;
      if (len < 300) continue;
      const n = Math.ceil(len / 900);
      const w = len / n;
      for (let k = 0; k < n; k++) bases.push({ run: s.r, u0: g0 + w * k, w, id: 'counter_base_600' });
    }
  }
  for (const f of [...fixed, ...bases]) put(runs[f.run]!.ed, f.id, f.u0, f.w);
  // 吊櫃：在下櫃區段上方（避開窗、冰箱）；爐台上方＝抽油煙機
  const upper = get('upper_cabinet_900');
  for (const f of [...fixed, ...bases]) {
    if (f.id === 'fridge_a') continue;
    const ed = runs[f.run]!.ed;
    if (ed.windows.some(([a, b]) => f.u0 < b && a < f.u0 + f.w)) continue;
    if (f.id === 'stove_600') {
      const hood = get('range_hood_900');
      if (hood) put(ed, 'range_hood_900', f.u0 - 150, 900, hood.elevationMm ?? 1500);
      continue;
    }
    if (upper) put(ed, 'upper_cabinet_900', f.u0, f.w, upper.elevationMm ?? 1450, objectDims(upper).d);
  }
  return out;
}

/** 衛浴：馬桶＋洗手台＋鏡子沿最長牆，淋浴間或浴缸在另一側 */
export function planBath(level: Level, catalog: Catalog, roomId: string): Placement[] {
  const edges = roomEdges(level, roomId);
  if (!edges) return [];
  const sorted = edges.map((e) => ({ e, spans: freeSpans(e, 50, e.L - 50) })).sort((a, b) => b.e.L - a.e.L);
  const out: Placement[] = [];
  const at = (ed: Edge, id: string, um: number, y = 0) => {
    const e = catalog.get(id);
    if (!e) return;
    const dep = objectDims(e).d;
    out.push({
      catalogId: id,
      position: [
        Math.round(ed.p[0] + ed.e[0] * um + ed.n[0] * (dep / 2 + 10)),
        y,
        Math.round(ed.p[1] + ed.e[1] * um + ed.n[1] * (dep / 2 + 10)),
      ],
      rotationY: Math.atan2(ed.n[0], ed.n[1]),
      scale: [1, 1, 1],
    });
  };
  const main = sorted[0];
  if (!main) return [];
  const span = main.spans.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!span || span[1] - span[0] < 1100) return [];
  at(main.e, 'basin_a', span[0] + 350);
  at(main.e, 'mirror_bath', span[0] + 350, catalog.get('mirror_bath')?.elevationMm ?? 1150);
  at(main.e, 'toilet_a', span[0] + 350 + 300 + 450);
  // 對面牆：夠長放浴缸，否則淋浴間
  const opp = sorted.find((x) => x.e.n[0] * main.e.n[0] + x.e.n[1] * main.e.n[1] < -0.9);
  if (opp) {
    const s2 = opp.spans.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    if (s2 && s2[1] - s2[0] >= 1650) at(opp.e, 'bathtub_1600', s2[0] + 820);
    else if (s2 && s2[1] - s2[0] >= 950) at(opp.e, 'shower_900', s2[0] + 460);
  }
  return out;
}
