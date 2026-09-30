import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Wall } from '@interiorai/scene-schema';
import { buildingFootprint, offsetPolygon, roundCorners } from '../src/index.js';
import { polygonArea, pointInPolygon, type Vec2 } from '../src/vec.js';

const wall = (id: string, a: Vec2, b: Vec2, thickness = 200): Wall => ({ id, a, b, thickness });
/** L 形：6000×4000 缺右上 2000×2000 */
const L = [
  wall('a', [0, 0], [4000, 0]),
  wall('b', [4000, 0], [4000, 2000]),
  wall('c', [4000, 2000], [6000, 2000]),
  wall('d', [6000, 2000], [6000, 4000]),
  wall('e', [6000, 4000], [0, 4000]),
  wall('f', [0, 4000], [0, 0]),
];

describe('buildingFootprint / 偏移', () => {
  it('外框＝牆外緣外擴 margin；只有外環（洞＝室內被捨棄）', () => {
    const fp = buildingFootprint({ walls: L }, 100);
    expect(fp).toHaveLength(1);
    const xs = fp[0]!.map((p) => p[0]);
    const ys = fp[0]!.map((p) => p[1]);
    // 牆厚 200 → 外緣 -100，再外擴 100 → -200
    expect(Math.min(...xs)).toBe(-200);
    expect(Math.max(...ys)).toBe(4200);
    expect(pointInPolygon([3000, 1000], fp[0]!)).toBe(true);
    expect(pointInPolygon([5500, 500], fp[0]!)).toBe(false); // L 的缺口
  });

  it('倒圓角：凸角與凹角都變圓，面積略減但仍包住所有牆', () => {
    const sharp = buildingFootprint({ walls: L }, 100);
    const round = buildingFootprint({ walls: L }, 100, 300);
    expect(round[0]!.length).toBeGreaterThan(sharp[0]!.length);
    expect(Math.abs(polygonArea(round[0]!))).toBeLessThan(Math.abs(polygonArea(sharp[0]!)));
    for (const w of L) for (const p of [w.a, w.b]) expect(pointInPolygon(p as Vec2, round[0]!)).toBe(true);
    // 凹角（缺口內角 4200,1800）被填圓：角落外側的點原本在外框外，倒圓角後在裡面
    expect(pointInPolygon([4240, 1760], sharp[0]!)).toBe(false);
    expect(pointInPolygon([4240, 1760], round[0]!)).toBe(true);
  });

  it('矩形外擴 d → 邊長各加 2d（property）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 20000 }),
        fc.integer({ min: 500, max: 20000 }),
        fc.integer({ min: 1, max: 500 }),
        (w, h, d) => {
          const r: Vec2[] = [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
          ];
          const o = offsetPolygon([r], d, false)[0]!;
          const xs = o.map((p) => p[0]);
          return Math.max(...xs) - Math.min(...xs) === w + 2 * d;
        },
      ),
      { numRuns: 50 },
    );
    expect(roundCorners([], 10)).toEqual([]);
  });
});
