import {
  booleanOpWithPolyTree,
  ClipType,
  difference,
  EndType,
  FillRule,
  inflatePaths,
  JoinType,
  PolyTree64,
  type Path64,
  type PolyPath64,
} from 'clipper2-ts';
import { roundMm, type Vec2 } from './vec.js';

/** Clipper2 內部以 ×1000（μm）整數運算（ADR-013） */
export const CLIP_SCALE = 1000;

export interface Polygon {
  outer: Vec2[];
  holes: Vec2[][];
}

export const toPath = (poly: readonly Vec2[]): Path64 =>
  poly.map(([x, y]) => ({ x: Math.round(x * CLIP_SCALE), y: Math.round(y * CLIP_SCALE) }));

/** 回 mm 整數並去除相鄰重複點 */
export const fromPath = (path: Path64): Vec2[] => {
  const out: Vec2[] = [];
  for (const p of path) {
    const v: Vec2 = [roundMm(p.x / CLIP_SCALE), roundMm(p.y / CLIP_SCALE)];
    const last = out[out.length - 1];
    if (!last || last[0] !== v[0] || last[1] !== v[1]) out.push(v);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
};

function collect(node: PolyPath64, out: Polygon[]) {
  for (let i = 0; i < node.count; i++) {
    const outerNode = node.child(i);
    const outer = fromPath(outerNode.poly ?? []);
    const holes: Vec2[][] = [];
    for (let j = 0; j < outerNode.count; j++) {
      const holeNode = outerNode.child(j);
      holes.push(fromPath(holeNode.poly ?? []));
      collect(holeNode, out); // 洞內的島
    }
    if (outer.length >= 3) out.push({ outer, holes: holes.filter((h) => h.length >= 3) });
  }
}

export function unionPolygons(polys: readonly Vec2[][]): Polygon[] {
  if (polys.length === 0) return [];
  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Union, polys.map(toPath), null, tree, FillRule.NonZero);
  const out: Polygon[] = [];
  collect(tree, out);
  return out;
}

/** subject − clips；clips 以 EvenOdd 解讀，因此可直接傳入「外框＋洞」的所有環 */
export function subtractPolygons(subject: readonly Vec2[], clips: readonly Vec2[][]): Vec2[][] {
  return difference([toPath(subject)], clips.map(toPath), FillRule.EvenOdd)
    .map(fromPath)
    .filter((p) => p.length >= 3);
}

/** 多邊形偏移（delta>0 外擴、<0 內縮），round＝圓角接合；可能分裂成多塊 */
export function offsetPolygon(polys: readonly Vec2[][], delta: number, round = true): Vec2[][] {
  if (!polys.length) return [];
  return inflatePaths(
    polys.map(toPath),
    delta * CLIP_SCALE,
    round ? JoinType.Round : JoinType.Miter,
    EndType.Polygon,
    2,
    0.25 * CLIP_SCALE,
  )
    .map(fromPath)
    .filter((p) => p.length >= 3);
}

/** 凸角與凹角都倒圓角（半徑 r）：先外擴 r、內縮 2r、再外擴 r（閉運算＋開運算） */
export function roundCorners(polys: readonly Vec2[][], r: number): Vec2[][] {
  if (r <= 0) return polys.map((p) => [...p]);
  return offsetPolygon(offsetPolygon(offsetPolygon(polys, r), -2 * r), r);
}
