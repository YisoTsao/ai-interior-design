import { objectDims, type Catalog, type CatalogEntry, type Material } from '@interiorai/catalog';
import {
  detectRooms,
  objectFootprint,
  objectInRoom,
  pointInPolygon,
  roomWallFaces,
  wallLength,
  type DetectedRoom,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Level, Room, Scene, SceneObject, Wall } from '@interiorai/scene-schema';

/** 助理執行時需要的場景資訊（全部由程式計算；LLM 只看到 summarizeScene 的摘要） */
export interface AssistantCtx {
  scene: Scene;
  level: Level;
  catalog: Catalog;
  materials: ReadonlyMap<string, Material>;
}

export const levelOf = (scene: Scene, levelId?: string): Level =>
  scene.levels.find((l) => l.id === levelId) ?? scene.levels[0]!;

export function makeCtx(
  scene: Scene,
  levelId: string | undefined,
  catalog: Catalog,
  materials: readonly Material[] | ReadonlyMap<string, Material>,
): AssistantCtx {
  return {
    scene,
    level: levelOf(scene, levelId),
    catalog,
    materials:
      materials instanceof Map ? materials : new Map((materials as Material[]).map((m) => [m.id, m])),
  };
}

const cache = new WeakMap<Level, DetectedRoom[]>();
/** 已命名房間 ↔ 偵測到的幾何（依 wallIds 比對） */
export function roomGeometry(level: Level, room: Room): DetectedRoom | undefined {
  let det = cache.get(level);
  if (!det) cache.set(level, (det = detectRooms(level).rooms));
  const key = [...room.wallIds].sort().join('|');
  return det.find((d) => d.key === key);
}

export const objectName = (ctx: AssistantCtx, o: Pick<SceneObject, 'catalogId'>) =>
  ctx.catalog.get(o.catalogId)?.nameZh ?? o.catalogId;

export function dimsOf(ctx: AssistantCtx, o: SceneObject) {
  const e = ctx.catalog.get(o.catalogId);
  return e ? objectDims(e, o.params ?? {}, o.scale) : { w: 500, d: 500, h: 500 };
}

export function footprintOf(ctx: AssistantCtx, o: SceneObject): Vec2[] {
  const d = dimsOf(ctx, o);
  return objectFootprint(o.position, o.rotationY, d.w, d.d);
}

/** 物件所在房間 id（roomId 優先，否則以位置判定） */
export function roomOfObject(ctx: AssistantCtx, o: SceneObject): string | null {
  for (const r of ctx.level.rooms) {
    const g = roomGeometry(ctx.level, r);
    if (g && objectInRoom(o, r.id, g.centerline)) return r.id;
  }
  return null;
}

export function roomAt(ctx: AssistantCtx, p: Vec2): Room | undefined {
  return ctx.level.rooms.find((r) => {
    const g = roomGeometry(ctx.level, r);
    return g && pointInPolygon(p, g.centerline);
  });
}

/** 平面方位（ADR-023）：2D 平面圖上方（−z）＝北、右方（+x）＝東 */
export type Compass = 'north' | 'south' | 'east' | 'west';
const COMPASS_ZH: Record<Compass, string> = { north: '北', south: '南', east: '東', west: '西' };

/** 外牆依所在的外框邊命名（北外牆…）；其他為隔間牆 */
export function wallCompass(level: Level, w: Wall): Compass | null {
  if (w.type !== 'exterior') return null;
  const xs = level.walls.flatMap((x) => [x.a[0], x.b[0]]);
  const zs = level.walls.flatMap((x) => [x.a[1], x.b[1]]);
  const tol = w.thickness;
  const on = (v0: number, v1: number, edge: number) =>
    Math.abs(v0 - edge) <= tol && Math.abs(v1 - edge) <= tol;
  if (on(w.a[1], w.b[1], Math.min(...zs))) return 'north';
  if (on(w.a[1], w.b[1], Math.max(...zs))) return 'south';
  if (on(w.a[0], w.b[0], Math.max(...xs))) return 'east';
  if (on(w.a[0], w.b[0], Math.min(...xs))) return 'west';
  return null;
}

/** 牆面朝房間內的法線方位（該牆位於房間的哪一側） */
export function wallSideInRoom(level: Level, w: Wall, room: Room): Compass | null {
  const g = roomGeometry(level, room);
  if (!g) return null;
  const n = g.centerline.length;
  const c: Vec2 = [
    g.centerline.reduce((s, p) => s + p[0] / n, 0),
    g.centerline.reduce((s, p) => s + p[1] / n, 0),
  ];
  const L = wallLength(w) || 1;
  const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
  const horizontal = Math.abs(d[0]) >= Math.abs(d[1]);
  const mx = (w.a[0] + w.b[0]) / 2;
  const mz = (w.a[1] + w.b[1]) / 2;
  if (horizontal) return mz < c[1] ? 'north' : 'south';
  return mx < c[0] ? 'west' : 'east';
}

export function wallName(level: Level, w: Wall): string {
  const c = wallCompass(level, w);
  return c ? `${COMPASS_ZH[c]}外牆` : '隔間牆';
}

/** 牆面相鄰的房間 */
export function roomsOfWall(level: Level, wallId: string): string[] {
  return level.rooms
    .filter((r) => {
      const g = roomGeometry(level, r);
      return g && roomWallFaces(level, g).some((f) => f.wallId === wallId);
    })
    .map((r) => r.id);
}

export const isPublished = (e: CatalogEntry | undefined): e is CatalogEntry =>
  !!e && e.status === 'published';

export const round = (v: number) => Math.round(v) + 0;
