import type { Level, Wall } from '@interiorai/scene-schema';
import { subtractPolygons } from './clip.js';
import { wallOutline } from './walls.js';
import {
  closestOnSegment,
  polygonArea,
  pointInPolygon,
  roundVec,
  signedArea,
  sub,
  type Vec2,
} from './vec.js';

export interface DetectedRoom {
  /** 由 wallIds 排序後組成的穩定鍵，可用於比對既有 Room */
  key: string;
  wallIds: string[];
  /** 牆中心線圍成的多邊形（逆時針） */
  centerline: Vec2[];
  /** 扣除牆體後的淨地板多邊形（最大塊） */
  floor: Vec2[];
  /** 中心線面積 mm² */
  area: number;
  /** 淨地板面積 mm² */
  netArea: number;
}

export interface RoomDetection {
  rooms: DetectedRoom[];
  /** 不屬於任何封閉房間的牆（懸空或未封閉） */
  unclosedWallIds: string[];
  warnings: { code: 'HOLE_UNSUPPORTED'; roomKey: string }[];
}

const TOL = 1;
const keyOf = (p: Vec2) => `${Math.round(p[0])},${Math.round(p[1])}`;

/** 把牆在端點/T 點/交叉點切開，建立平面圖 */
function buildGraph(walls: readonly Wall[]) {
  const splits = new Map<string, Vec2[]>(); // wallId → 切點
  for (const w of walls) splits.set(w.id, [w.a as Vec2, w.b as Vec2]);
  for (const w of walls) {
    for (const o of walls) {
      if (o.id === w.id) continue;
      // o 的端點落在 w 上
      for (const p of [o.a as Vec2, o.b as Vec2]) {
        const c = closestOnSegment(p, w.a as Vec2, w.b as Vec2);
        if (c.distance <= TOL && c.t > 0 && c.t < 1) splits.get(w.id)!.push(p);
      }
      // 真交叉（X）
      const x = segmentCross(w.a as Vec2, w.b as Vec2, o.a as Vec2, o.b as Vec2);
      if (x) splits.get(w.id)!.push(roundVec(x));
    }
  }
  const nodes = new Map<string, Vec2>();
  const edges: { u: string; v: string; wallId: string }[] = [];
  for (const w of walls) {
    const a = w.a as Vec2;
    const d = sub(w.b as Vec2, a);
    const l2 = d[0] * d[0] + d[1] * d[1];
    const pts = splits
      .get(w.id)!
      .map((p) => ({ p, t: ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2 }))
      .sort((x, y) => x.t - y.t);
    for (let i = 1; i < pts.length; i++) {
      const u = keyOf(pts[i - 1]!.p);
      const v = keyOf(pts[i]!.p);
      if (u === v) continue;
      nodes.set(u, pts[i - 1]!.p);
      nodes.set(v, pts[i]!.p);
      edges.push({ u, v, wallId: w.id });
    }
  }
  return { nodes, edges };
}

function segmentCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): Vec2 | null {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const d = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(d) < 1e-9) return null;
  const qp = sub(q1, p1);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / d;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / d;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [p1[0] + t * r[0], p1[1] + t * r[1]];
}

/**
 * 由牆圖偵測封閉房間（S1.6）。未封閉牆圖回空 rooms 並列出 unclosedWallIds（ADR-013）。
 * 含洞（天井）房間 v1 不支援：偵測到時回報 HOLE_UNSUPPORTED 警告。
 */
export function detectRooms(level: Pick<Level, 'walls'>): RoomDetection {
  const walls = level.walls;
  const { nodes, edges } = buildGraph(walls);

  // 移除懸空邊（反覆剝除度數 1 的節點）
  const alive = new Set(edges.map((_, i) => i));
  const degree = (k: string) => [...alive].filter((i) => edges[i]!.u === k || edges[i]!.v === k).length;
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...alive]) {
      const e = edges[i]!;
      if (degree(e.u) < 2 || degree(e.v) < 2) {
        alive.delete(i);
        changed = true;
      }
    }
  }

  // 半邊與依角度排序的鄰接
  type Half = { from: string; to: string; wallId: string; used: boolean };
  const halves: Half[] = [];
  const out = new Map<string, Half[]>();
  for (const i of alive) {
    const e = edges[i]!;
    for (const [from, to] of [
      [e.u, e.v],
      [e.v, e.u],
    ] as const) {
      const h = { from, to, wallId: e.wallId, used: false };
      halves.push(h);
      out.set(from, [...(out.get(from) ?? []), h]);
    }
  }
  const angle = (h: Half) => {
    const a = nodes.get(h.from)!;
    const b = nodes.get(h.to)!;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const list of out.values()) list.sort((x, y) => angle(x) - angle(y));

  const faces: { poly: Vec2[]; wallIds: string[] }[] = [];
  for (const start of halves) {
    if (start.used) continue;
    const poly: Vec2[] = [];
    const ids = new Set<string>();
    let h: Half = start;
    let guard = 0;
    while (!h.used && guard++ < halves.length + 1) {
      h.used = true;
      poly.push(nodes.get(h.from)!);
      ids.add(h.wallId);
      // 在 to 節點，取反向半邊的「順時針下一條」→ 逆時針走訪內部面
      const list = out.get(h.to)!;
      const back = list.findIndex((x) => x.to === h.from && x.wallId === h.wallId);
      h = list[(back - 1 + list.length) % list.length]!;
    }
    faces.push({ poly, wallIds: [...ids] });
  }

  const outline = wallOutline(level);
  const wallPolys = outline.flatMap((p) => [p.outer, ...p.holes]);
  const rooms: DetectedRoom[] = faces
    .filter((f) => signedArea(f.poly) > 0)
    .map((f) => {
      const floors = subtractPolygons(f.poly, wallPolys).sort((a, b) => polygonArea(b) - polygonArea(a));
      const floor = floors[0] ?? [];
      const wallIds = [...f.wallIds].sort();
      return {
        key: wallIds.join('|'),
        wallIds,
        centerline: f.poly,
        floor,
        area: polygonArea(f.poly),
        netArea: polygonArea(floor),
      };
    });

  const warnings: RoomDetection['warnings'] = [];
  const cycleNodes = [...new Set([...alive].flatMap((i) => [edges[i]!.u, edges[i]!.v]))].map((k) =>
    nodes.get(k)!,
  );
  for (const r of rooms) {
    const inside = cycleNodes.some(
      (p) => !r.centerline.some((q) => q[0] === p[0] && q[1] === p[1]) && pointInPolygon(p, r.centerline),
    );
    if (inside) warnings.push({ code: 'HOLE_UNSUPPORTED', roomKey: r.key });
  }

  const inRoom = new Set(rooms.flatMap((r) => r.wallIds));
  return { rooms, unclosedWallIds: walls.filter((w) => !inRoom.has(w.id)).map((w) => w.id), warnings };
}
