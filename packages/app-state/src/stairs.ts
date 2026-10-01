import { objectDims, type Catalog } from '@interiorai/catalog';
import { objectFootprint, type Vec2 } from '@interiorai/core-geometry';
import type { Scene } from '@interiorai/scene-schema';

/**
 * 樓梯自動開洞（FE-LVL-04）：下一層（標高較低且最接近的樓層）上的樓梯，頂端到達本層樓板（誤差 300 mm 內）時，
 * 本層樓板挖掉樓梯的佔地範圍。純函式：2D（開口虛線）與 3D（樓板挖洞）共用，不寫入 Scene。
 */
export function stairOpenings(scene: Pick<Scene, 'levels'>, levelId: string, catalog: Catalog): Vec2[][] {
  const lv = scene.levels.find((l) => l.id === levelId);
  if (!lv) return [];
  const below = scene.levels
    .filter((l) => l.elevation < lv.elevation)
    .sort((a, b) => b.elevation - a.elevation)[0];
  if (!below) return [];
  const out: Vec2[][] = [];
  for (const o of below.objects) {
    const e = catalog.get(o.catalogId);
    if (e?.model.kind !== 'parametric' || e.model.type !== 'stairs') continue;
    const d = objectDims(e, o.params, o.scale);
    const top = below.elevation + o.position[1] + d.h;
    if (Math.abs(top - lv.elevation) > 300 && top < lv.elevation) continue;
    out.push(objectFootprint(o.position, o.rotationY, d.w, d.d));
  }
  return out;
}
