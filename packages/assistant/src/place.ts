import {
  closestOnSegment,
  findCollisions,
  objectFootprint,
  pointInPolygon,
  wallLength,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Level, SceneObject, Wall } from '@interiorai/scene-schema';
import { dimsOf, footprintOf, roomGeometry, type AssistantCtx } from './context.js';

export type Side = 'left' | 'right' | 'front' | 'back';
export interface Pose {
  x: number;
  z: number;
  rotationY: number;
}
interface Body {
  w: number;
  d: number;
  rotationY: number;
}

/**
 * 物件局部座標（Three.js 繞 +Y，與 core-geometry objectFootprint 相同）：
 * 正面 front＝局部 +z → 世界 (sin θ, cos θ)；
 * 左右以「站在物件後方、面向正面」的視角定義（坐在沙發上的人的左右）：右＝局部 −x。
 */
export const frontDir = (r: number): Vec2 => [Math.sin(r), Math.cos(r)];
const localX = (r: number): Vec2 => [Math.cos(r), -Math.sin(r)];
export function sideDir(r: number, side: Side): Vec2 {
  const f = frontDir(r);
  const x = localX(r);
  if (side === 'front') return f;
  if (side === 'back') return [-f[0], -f[1]];
  return side === 'right' ? [-x[0], -x[1]] : x;
}
/** 旋轉矩形在方向 dir 上的半長 */
export function extentAlong(b: Body, dir: Vec2): number {
  const f = frontDir(b.rotationY);
  const x = localX(b.rotationY);
  return (
    (Math.abs(dir[0] * x[0] + dir[1] * x[1]) * b.w) / 2 + (Math.abs(dir[0] * f[0] + dir[1] * f[1]) * b.d) / 2
  );
}

const rot0 = (r: number) => Math.round((((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1e6) / 1e6;

/** 貼齊另一件物件的某一側（保留自身方向） */
export function besideObject(ctx: AssistantCtx, mover: Body, ref: SceneObject, side: Side, gap = 0): Pose {
  const rd = dimsOf(ctx, ref);
  const dir = sideDir(ref.rotationY, side);
  const k = extentAlong({ w: rd.w, d: rd.d, rotationY: ref.rotationY }, dir) + extentAlong(mover, dir) + gap;
  return { x: ref.position[0] + dir[0] * k, z: ref.position[2] + dir[1] * k, rotationY: mover.rotationY };
}

/** 牆的單位方向與 A 側法線 */
function frame(w: Wall) {
  const L = wallLength(w) || 1;
  const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
  return { L, d, n: [-d[1], d[0]] as Vec2 };
}

/**
 * 背靠牆擺放（正面朝向房間內）：roomPoint 決定放在牆的哪一側；u＝沿牆位置（mm，從 a 端起算）。
 * 回傳的位置若不在該房間內，改用房間中心在牆上的投影（避免跨到隔壁房間）。
 */
export function againstWall(
  ctx: AssistantCtx,
  mover: Pick<Body, 'w' | 'd'>,
  w: Wall,
  roomPoint: Vec2,
  u: number | null,
  gap = 0,
  roomPoly?: readonly Vec2[],
): Pose {
  const { L, d, n } = frame(w);
  const s = (roomPoint[0] - w.a[0]) * n[0] + (roomPoint[1] - w.a[1]) * n[1] >= 0 ? 1 : -1;
  const ns: Vec2 = [n[0] * s, n[1] * s];
  const off = w.thickness / 2 + mover.d / 2 + gap;
  const lo = Math.min(L / 2, mover.w / 2 + 50);
  const at = (uu: number): Vec2 => {
    const c = Math.min(L - lo, Math.max(lo, uu));
    return [w.a[0] + d[0] * c + ns[0] * off, w.a[1] + d[1] * c + ns[1] * off];
  };
  const along = (p: Vec2) => (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1];
  let p = at(u ?? along(roomPoint));
  if (roomPoly && !pointInPolygon(p, roomPoly)) {
    const n2 = roomPoly.length;
    const c: Vec2 = [
      roomPoly.reduce((a, q) => a + q[0] / n2, 0),
      roomPoly.reduce((a, q) => a + q[1] / n2, 0),
    ];
    p = at(along(c));
  }
  return { x: p[0], z: p[1], rotationY: rot0(Math.atan2(ns[0], ns[1])) };
}

/** 窗前（front）或窗的左右側（面向窗戶時的左右） */
export function atWindow(
  ctx: AssistantCtx,
  mover: Pick<Body, 'w' | 'd'>,
  level: Level,
  openingId: string,
  roomPoint: Vec2,
  side: Side,
  gap = 0,
): Pose | null {
  const o = level.openings.find((x) => x.id === openingId);
  const w = o && level.walls.find((x) => x.id === o.wallId);
  if (!o || !w) return null;
  const { d, n } = frame(w);
  const s = (roomPoint[0] - w.a[0]) * n[0] + (roomPoint[1] - w.a[1]) * n[1] >= 0 ? 1 : -1;
  // 面向牆（視線 −ns）時的右手方向＝(ns.z, −ns.x)；換算成沿牆 u 的正負
  const right: Vec2 = [n[1] * s, -n[0] * s];
  const sign = right[0] * d[0] + right[1] * d[1] >= 0 ? 1 : -1;
  let u = o.offset + o.width / 2;
  if (side === 'right') u += sign * (o.width / 2 + mover.w / 2 + gap);
  if (side === 'left') u -= sign * (o.width / 2 + mover.w / 2 + gap);
  return againstWall(ctx, mover, w, roomPoint, u, side === 'front' || side === 'back' ? gap : 0);
}

/** 碰撞輸入（與 editor-2d collisionInputs 相同規則：高度 ≤ 30 mm 視為地毯類） */
export function collisionInputs(ctx: AssistantCtx, objects: readonly SceneObject[]) {
  return objects.map((o) => {
    const e = ctx.catalog.get(o.catalogId);
    const dm = dimsOf(ctx, o);
    return {
      id: o.id,
      poly: footprintOf(ctx, o),
      anchor: e?.anchor,
      floorCovering: dm.h <= 30,
      y0: o.position[1],
      y1: o.position[1] + dm.h,
    };
  });
}

/** 把 obj 放到 pose 後，與哪些物件/牆重疊（只警示） */
export function collisionsAfter(ctx: AssistantCtx, obj: SceneObject, pose: Pose) {
  const moved: SceneObject = {
    ...obj,
    position: [pose.x, obj.position[1], pose.z],
    rotationY: pose.rotationY,
  };
  const others = ctx.level.objects.filter((o) => o.id !== obj.id);
  const inputs = collisionInputs(ctx, [moved, ...others]);
  return findCollisions(ctx.level, inputs).filter((c) => c.objectId === obj.id || c.otherId === obj.id);
}

/** 在房間淨地板內找離 target 最近、不與其他物件重疊的位置（100 mm 格點） */
export function freeSpot(ctx: AssistantCtx, obj: SceneObject, roomId: string, target?: Vec2): Pose | null {
  const room = ctx.level.rooms.find((r) => r.id === roomId);
  const g = room && roomGeometry(ctx.level, room);
  if (!g) return null;
  const n = g.floor.length;
  const c: Vec2 = target ?? [
    g.floor.reduce((s, p) => s + p[0] / n, 0),
    g.floor.reduce((s, p) => s + p[1] / n, 0),
  ];
  const dm = dimsOf(ctx, obj);
  const xs = g.floor.map((p) => p[0]);
  const zs = g.floor.map((p) => p[1]);
  const cands: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 100)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 100) cands.push([x, z]);
  cands.sort((a, b) => Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]));
  for (const p of cands) {
    const fp = objectFootprint([p[0], 0, p[1]], obj.rotationY, dm.w, dm.d);
    if (!fp.every((q) => pointInPolygon(q, g.floor))) continue;
    if (collisionsAfter(ctx, obj, { x: p[0], z: p[1], rotationY: obj.rotationY }).length === 0)
      return { x: p[0], z: p[1], rotationY: obj.rotationY };
  }
  return null;
}

/** 點到多邊形的距離（點在內部為 0） */
export function polygonGap(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
  let best = Infinity;
  const edges = (poly: readonly Vec2[]) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as const);
  for (const p of a) for (const [q, r] of edges(b)) best = Math.min(best, closestOnSegment(p, q, r).distance);
  for (const p of b) for (const [q, r] of edges(a)) best = Math.min(best, closestOnSegment(p, q, r).distance);
  return best;
}
