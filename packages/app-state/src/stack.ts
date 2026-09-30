import { objectDims, type Catalog } from '@interiorai/catalog';
import { objectFootprint, pointInPolygon, signedArea, type Vec2 } from '@interiorai/core-geometry';
import type { Level, SceneObject } from '@interiorai/scene-schema';

/**
 * 疊放吸附（FE-V3D-04）：落地物件的中心若落在另一件家具的頂面上（桌、櫃、床頭櫃…），
 * 離地高自動設為該家具頂面；否則回到地面。只有較小的物件能疊（面積 < 支撐面 70%、高 < 1.2 m），
 * 支撐物頂面須 ≤ 1.6 m，地毯等薄件不當支撐。
 */
export function stackElevation(
  level: Pick<Level, 'objects'>,
  catalog: Catalog,
  mover: Pick<SceneObject, 'catalogId' | 'params' | 'scale'> & { id?: string },
  pos: Vec2,
  rotationY: number,
): number | null {
  const e = catalog.get(mover.catalogId);
  if (!e || e.anchor !== 'floor') return null;
  const d = objectDims(e, mover.params, mover.scale);
  const area = Math.abs(signedArea(objectFootprint([pos[0], 0, pos[1]], rotationY, d.w, d.d)));
  if (d.h > 1200) return 0;
  let best = 0;
  for (const o of level.objects) {
    if (o.id === mover.id || o.appearance?.hidden) continue;
    const s = catalog.get(o.catalogId);
    if (!s || s.anchor !== 'floor') continue;
    const sd = objectDims(s, o.params, o.scale);
    const top = o.position[1] + sd.h;
    if (sd.h <= 30 || top > 1600) continue;
    const fp = objectFootprint(o.position, o.rotationY, sd.w, sd.d);
    if (!pointInPolygon(pos, fp)) continue;
    if (area >= Math.abs(signedArea(fp)) * 0.7) continue;
    best = Math.max(best, Math.round(top));
  }
  return best;
}
