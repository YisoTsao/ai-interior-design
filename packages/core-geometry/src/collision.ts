import type { Level } from '@interiorai/scene-schema';
import { subtractPolygons, type Polygon } from './clip.js';
import { polygonArea, type Vec2 } from './vec.js';
import { wallOutline } from './walls.js';

/** 物件在平面上的旋轉矩形（逆時針）；rotationY 為繞 +Y 的弧度（Three.js 右手系） */
export function objectFootprint(
  position: readonly number[],
  rotationY: number,
  w: number,
  d: number,
): Vec2[] {
  const cx = position[0] ?? 0;
  const cz = position[2] ?? 0;
  // Three.js 繞 +Y 旋轉 θ：x' = x cos + z sin；z' = −x sin + z cos
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const corners: Vec2[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  const pts = corners.map(([x, z]): Vec2 => [cx + x * c + z * s, cz - x * s + z * c]);
  return pts;
}

/** 兩多邊形重疊面積（mm²），用 clipper：A − (A − B) */
export function overlapArea(a: readonly Vec2[], b: readonly Vec2[]): number {
  const aArea = polygonArea(a);
  const rest = subtractPolygons(a, [b as Vec2[]]).reduce((s, p) => s + polygonArea(p), 0);
  return Math.max(0, aArea - rest);
}

export interface CollisionWarning {
  kind: 'wall' | 'object';
  objectId: string;
  otherId?: string;
  overlapMm2: number;
}

/**
 * 穿牆/重疊警示（FR-304、B3.7）：只警示不阻擋。容差：重疊 < minOverlapMm2 忽略（避免貼牆誤報）。
 * footprints 由呼叫端依 catalog 尺寸算好傳入（core-geometry 不依賴 catalog）。
 */
export function findCollisions(
  level: Pick<Level, 'walls'>,
  /** floorCovering：地毯等平貼地面物件，不參與重疊判定 */
  footprints: readonly {
    id: string;
    poly: Vec2[];
    anchor?: 'floor' | 'wall' | 'ceiling';
    floorCovering?: boolean;
  }[],
  minOverlapMm2 = 2500,
): CollisionWarning[] {
  const out: CollisionWarning[] = [];
  const walls: Polygon[] = wallOutline(level);
  const wallRings = walls.flatMap((p) => [p.outer, ...p.holes]);
  for (const f of footprints) {
    if (f.anchor === 'wall') continue;
    // 物件落在牆體實心部分的面積 = 物件 − (物件 − 牆)；牆以 EvenOdd（外框＋洞）表示
    const outside = subtractPolygons(f.poly, wallRings).reduce((s, p) => s + polygonArea(p), 0);
    const inWall = polygonArea(f.poly) - outside;
    if (inWall >= minOverlapMm2) out.push({ kind: 'wall', objectId: f.id, overlapMm2: Math.round(inWall) });
  }
  for (let i = 0; i < footprints.length; i++)
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]!;
      const b = footprints[j]!;
      if (a.anchor === 'ceiling' || b.anchor === 'ceiling' || a.floorCovering || b.floorCovering) continue;
      const ov = overlapArea(a.poly, b.poly);
      if (ov >= minOverlapMm2)
        out.push({ kind: 'object', objectId: a.id, otherId: b.id, overlapMm2: Math.round(ov) });
    }
  return out;
}
