import type { Level, Opening, Scene, Wall } from '@interiorai/scene-schema';
import { detectRooms, type DetectedRoom } from './rooms.js';
import { wallLength } from './walls.js';
import { closestOnSegment, pointInPolygon, type Vec2 } from './vec.js';

export interface CatalogEntry {
  id: string;
  name?: string;
  /** 單價（新台幣整數元）；未知時省略 */
  unitPriceTwd?: number;
}
export interface Catalog {
  get(id: string): CatalogEntry | undefined;
}
export interface MaterialPrice {
  /** 每平方公尺單價（新台幣整數元） */
  pricePerM2Twd?: number;
}

export type BomUnit = 'pcs' | 'm2';
export type BomKind = 'object' | 'opening' | 'wall_finish' | 'floor_finish' | 'ceiling_finish';
export interface BomLine {
  kind: BomKind;
  key: string;
  quantity: number;
  unit: BomUnit;
  unitPriceTwd?: number;
  subtotalTwd?: number;
}
export interface BOM {
  lines: BomLine[];
  totalTwd: number;
  /** 沒有價格資料的項目（不計入總價） */
  unpricedKeys: string[];
}
export interface BomOptions {
  /** 只計算單一房間（估價 scope=room）；找不到房間時丟錯 */
  roomId?: string;
  /** 門窗 → 計價用的目錄項（null＝不計價，例如無門框的通道）；預設見 defaultOpeningCatalogId */
  openingCatalogId?: (o: Opening) => string | null;
}

const MM2_PER_M2 = 1_000_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** 預設的門窗計價對應（〔假設〕以寬度/高度分級，對應種子目錄的門窗模組） */
export function defaultOpeningCatalogId(o: Pick<Opening, 'type' | 'width' | 'height'>): string | null {
  if (o.type === 'door') return o.width >= 1200 ? 'door_double_1500' : 'door_single_900';
  if (o.type === 'window') return o.height >= 1800 ? 'window_1800' : 'window_1200';
  return null;
}

/** 牆面在 a→b 左側（A 面，法線 perp(d)，與 viewer-3d walls3d 相同約定）或右側（B 面） */
const faceMaterial = (w: Wall, side: 'A' | 'B') =>
  side === 'A' ? w.materialId : (w.materialIdB ?? w.materialId);

/**
 * 房間的牆面面積：沿淨地板多邊形的每條邊找出所貼的牆（平行、距中心線 ≈ 牆厚/2），
 * 以「邊長×樓高 − 落在該邊範圍內的開口」計算，並依房間在牆的哪一側決定 A/B 面材質。
 */
export function roomWallFaces(level: Level, room: DetectedRoom) {
  const out: { wallId: string; side: 'A' | 'B'; areaMm2: number; materialId?: string }[] = [];
  const poly = room.floor;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const edgeLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (edgeLen < 1) continue;
    let best: { w: Wall; dist: number; side: 'A' | 'B' } | null = null;
    for (const w of level.walls) {
      const L = wallLength(w);
      if (L < 1) continue;
      const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const e: Vec2 = [(q[0] - p[0]) / edgeLen, (q[1] - p[1]) / edgeLen];
      if (Math.abs(d[0] * e[1] - d[1] * e[0]) > 0.01) continue; // 不平行
      const c = closestOnSegment(mid, w.a as Vec2, w.b as Vec2);
      if (Math.abs(c.distance - w.thickness / 2) > 2) continue;
      const n: Vec2 = [-d[1], d[0]];
      const side = (mid[0] - c.point[0]) * n[0] + (mid[1] - c.point[1]) * n[1] >= 0 ? 'A' : 'B';
      if (!best || c.distance < best.dist) best = { w, dist: c.distance, side };
    }
    if (!best) continue;
    const { w, side } = best;
    const L = wallLength(w);
    const along = (v: Vec2) =>
      ((v[0] - w.a[0]) * (w.b[0] - w.a[0]) + (v[1] - w.a[1]) * (w.b[1] - w.a[1])) / L;
    const [u0, u1] = [along(p), along(q)].sort((x, y) => x - y) as [number, number];
    const openingArea = level.openings
      .filter((o) => o.wallId === w.id)
      .reduce((s, o) => {
        const overlap = Math.max(0, Math.min(u1, o.offset + o.width) - Math.max(u0, o.offset));
        const h = Math.max(0, Math.min(level.height, (o.sill ?? 0) + o.height) - (o.sill ?? 0));
        return s + overlap * h;
      }, 0);
    out.push({
      wallId: w.id,
      side,
      areaMm2: Math.max(0, edgeLen * level.height - openingArea),
      materialId: faceMaterial(w, side),
    });
  }
  return out;
}

/** 物件是否屬於該房間：有 roomId 以它為準，否則以位置落在房間中心線多邊形內判定 */
export const objectInRoom = (
  o: { roomId?: string; position: readonly number[] },
  roomId: string,
  centerline: readonly Vec2[],
) => (o.roomId ? o.roomId === roomId : pointInPolygon([o.position[0]!, o.position[2]!], centerline));

/**
 * BOM／估價（S1.8 骨架 → P6 完整）：純函式；數量全由場景計算，不經 LLM（B6.4-2）。
 * 專案範圍：
 * - 物件：依 catalogId 計數；門窗：依 openingCatalogId 計數
 * - 牆面：每面牆「長×樓高−開口」×2 面（A/B 面材質），單位 m²
 * - 地板／天花：房間淨面積，依 Room.floorMaterialId / ceilingMaterialId
 * 房間範圍（opts.roomId）：房內物件、面向房間的牆面（roomWallFaces）、該房地板/天花、房間牆上的門窗。
 */
export function computeBOM(
  scene: Scene,
  catalog: Catalog,
  materials: Record<string, MaterialPrice> = {},
  opts: BomOptions = {},
): BOM {
  const openingId = opts.openingCatalogId ?? defaultOpeningCatalogId;
  const qty = new Map<string, BomLine>();
  const addLine = (kind: BomKind, key: string, q: number, unit: BomUnit) => {
    const k = `${kind}:${key}`;
    const cur = qty.get(k) ?? { kind, key, quantity: 0, unit };
    cur.quantity += q;
    qty.set(k, cur);
  };
  const addOpening = (o: Opening) => {
    const id = openingId(o);
    if (id) addLine('opening', id, 1, 'pcs');
  };
  const addSurfaces = (lvl: Level, room: Level['rooms'][number], d: DetectedRoom) => {
    if (room.floorMaterialId) addLine('floor_finish', room.floorMaterialId, d.netArea / MM2_PER_M2, 'm2');
    if (room.ceilingMaterialId)
      addLine('ceiling_finish', room.ceilingMaterialId, d.netArea / MM2_PER_M2, 'm2');
  };
  let foundRoom = !opts.roomId;

  for (const lvl of scene.levels) {
    const detected = detectRooms(lvl).rooms;
    const detOf = (r: Level['rooms'][number]) => {
      const key = [...r.wallIds].sort().join('|');
      return detected.find((x) => x.key === key);
    };
    if (opts.roomId) {
      const room = lvl.rooms.find((r) => r.id === opts.roomId);
      const d = room && detOf(room);
      if (!room || !d) continue;
      foundRoom = true;
      for (const o of lvl.objects)
        if (objectInRoom(o, room.id, d.centerline)) addLine('object', o.catalogId, 1, 'pcs');
      const faces = roomWallFaces(lvl, d);
      for (const f of faces)
        if (f.materialId) addLine('wall_finish', f.materialId, f.areaMm2 / MM2_PER_M2, 'm2');
      const wallIds = new Set(faces.map((f) => f.wallId));
      // 開口屬於「牆面有在此房間內」的牆且位置落在房間的邊界範圍：以開口中點離房間中心線多邊形的距離判定
      for (const o of lvl.openings) {
        if (!wallIds.has(o.wallId)) continue;
        const w = lvl.walls.find((x) => x.id === o.wallId)!;
        const L = wallLength(w);
        const t = (o.offset + o.width / 2) / L;
        const m: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
        if (onBoundary(m, d.centerline)) addOpening(o);
      }
      addSurfaces(lvl, room, d);
      continue;
    }
    for (const o of lvl.objects) addLine('object', o.catalogId, 1, 'pcs');
    for (const o of lvl.openings) addOpening(o);
    for (const w of lvl.walls) {
      const openingArea = lvl.openings
        .filter((o) => o.wallId === w.id)
        .reduce((s, o) => s + o.width * o.height, 0);
      const face = Math.max(0, wallLength(w) * lvl.height - openingArea) / MM2_PER_M2;
      if (w.materialId) addLine('wall_finish', w.materialId, face, 'm2');
      if (w.materialIdB) addLine('wall_finish', w.materialIdB, face, 'm2');
    }
    for (const r of lvl.rooms) {
      const d = detOf(r);
      if (d) addSurfaces(lvl, r, d);
    }
  }
  if (!foundRoom) throw new Error(`找不到房間 ${opts.roomId}`);

  const unpricedKeys: string[] = [];
  let totalTwd = 0;
  const lines = [...qty.values()].map((l) => {
    const line = { ...l, quantity: l.unit === 'm2' ? round2(l.quantity) : l.quantity };
    const price =
      l.kind === 'object' || l.kind === 'opening'
        ? catalog.get(l.key)?.unitPriceTwd
        : materials[l.key]?.pricePerM2Twd;
    if (price === undefined) {
      unpricedKeys.push(l.key);
      return line;
    }
    const subtotalTwd = Math.round(price * line.quantity);
    totalTwd += subtotalTwd;
    return { ...line, unitPriceTwd: price, subtotalTwd };
  });
  lines.sort((a, b) => (a.kind + a.key).localeCompare(b.kind + b.key));
  return { lines, totalTwd, unpricedKeys: [...new Set(unpricedKeys)] };
}

/** 點是否在多邊形邊上（容差 mm；牆中心線多邊形的邊＝牆中心線） */
function onBoundary(p: Vec2, poly: readonly Vec2[], tol = 5) {
  for (let i = 0; i < poly.length; i++)
    if (closestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).distance <= tol) return true;
  return false;
}
