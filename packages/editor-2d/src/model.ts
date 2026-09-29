import { objectDims, type Catalog } from '@interiorai/catalog';
import { objectFootprint, pointOnWall, type Vec2 } from '@interiorai/core-geometry';
import type { Level, Opening, SceneObject } from '@interiorai/scene-schema';

/** 物件平面矩形（供繪製、點選、碰撞） */
export function footprintOf(o: SceneObject, catalog: Catalog): Vec2[] {
  const e = catalog.get(o.catalogId);
  const d = e
    ? objectDims(e, o.params, o.scale)
    : { w: 500 * (o.scale?.[0] ?? 1), d: 500 * (o.scale?.[2] ?? 1), h: 500 };
  return objectFootprint(o.position, o.rotationY, d.w, d.d);
}

/** 碰撞判定輸入：地毯等高度 ≤ 30mm 視為地面覆蓋物 */
export function collisionInputs(level: Level, catalog: Catalog) {
  return level.objects.map((o) => {
    const e = catalog.get(o.catalogId);
    const h = e ? objectDims(e, o.params, o.scale).h : 500;
    return { id: o.id, poly: footprintOf(o, catalog), anchor: e?.anchor, floorCovering: h <= 30 };
  });
}

export function openingEnds(level: Level, o: Opening): [Vec2, Vec2] | null {
  const w = level.walls.find((x) => x.id === o.wallId);
  if (!w) return null;
  return [pointOnWall(w, o.offset), pointOnWall(w, o.offset + o.width)];
}

export const flat = (pts: readonly Vec2[]) => pts.flatMap((p) => [p[0], p[1]]);
