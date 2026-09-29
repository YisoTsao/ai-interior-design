import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  areCollinearJoined,
  openingSegment,
  polygonArea,
  signedArea,
  wallOutline,
  wallQuad,
  type Polygon,
} from '../src/index.js';
import { level, rect, wall } from './fixtures.js';

const totalArea = (ps: Polygon[]) =>
  ps.reduce((s, p) => s + polygonArea(p.outer) - p.holes.reduce((h, x) => h + polygonArea(x), 0), 0);

describe('wallOutline', () => {
  it('單牆：方形端蓋，面積＝長×厚', () => {
    const out = wallOutline(level([wall('w1', [0, 0], [1000, 0], 100)]));
    expect(out).toHaveLength(1);
    expect(polygonArea(out[0]!.outer)).toBe(100_000);
    expect(out[0]!.outer).toEqual(
      expect.arrayContaining([
        [0, -50],
        [1000, -50],
        [1000, 50],
        [0, 50],
      ]),
    );
  });

  it('L 型（等厚）：真斜接，外角為 (−50,−50)，無缺角', () => {
    const out = wallOutline(level([wall('h', [0, 0], [1000, 0]), wall('v', [0, 0], [0, 1000])]));
    expect(out).toHaveLength(1);
    expect(out[0]!.outer).toContainEqual([-50, -50]);
    // 兩牆外框 1050×100 + 950×100 … 精確面積 = 1050*100 + 100*950
    expect(polygonArea(out[0]!.outer)).toBe(1050 * 100 + 950 * 100);
  });

  it('L 型（不等厚 200/100）：外角落在兩外緣交點 (−50,−100)', () => {
    const out = wallOutline(level([wall('h', [0, 0], [1000, 0], 200), wall('v', [0, 0], [0, 1000], 100)]));
    expect(out[0]!.outer).toContainEqual([-50, -100]);
  });

  it('L 型（120° 非直角）：輪廓封閉、單一多邊形', () => {
    const b: [number, number] = [
      Math.round(1000 * Math.cos((2 * Math.PI) / 3)),
      Math.round(1000 * Math.sin((2 * Math.PI) / 3)),
    ];
    const out = wallOutline(level([wall('h', [0, 0], [1000, 0]), wall('v', [0, 0], b)]));
    expect(out).toHaveLength(1);
    expect(out[0]!.holes).toHaveLength(0);
  });

  it('矩形房間：一個外框＋一個洞，洞為淨內部', () => {
    const out = wallOutline(level(rect(0, 0, 4000, 3000)));
    expect(out).toHaveLength(1);
    expect(out[0]!.holes).toHaveLength(1);
    expect(polygonArea(out[0]!.outer)).toBe(4100 * 3100);
    expect(polygonArea(out[0]!.holes[0]!)).toBe(3900 * 2900);
  });

  it('T 型接點：幹牆延伸到宿主內，無縫', () => {
    const out = wallOutline(level([wall('host', [0, 0], [2000, 0]), wall('stem', [1000, 0], [1000, 1000])]));
    expect(out).toHaveLength(1);
    expect(totalArea(out)).toBe(2000 * 100 + 100 * 950);
  });

  it('X 型（四牆共點）：單一多邊形，面積正確', () => {
    const c: [number, number] = [0, 0];
    const out = wallOutline(
      level([
        wall('e', c, [1000, 0]),
        wall('n', c, [0, 1000]),
        wall('w', c, [-1000, 0]),
        wall('s', c, [0, -1000]),
      ]),
    );
    expect(out).toHaveLength(1);
    expect(totalArea(out)).toBe(2000 * 100 + 100 * 1900);
  });

  it('X 型（兩牆中段交叉）：聯集自動處理', () => {
    const out = wallOutline(level([wall('a', [-1000, 0], [1000, 0]), wall('b', [0, -1000], [0, 1000])]));
    expect(out).toHaveLength(1);
    expect(totalArea(out)).toBe(2000 * 100 + 100 * 1900);
  });

  it('共線相接：平頭，不同厚度也不產生尖刺', () => {
    const out = wallOutline(level([wall('a', [0, 0], [1000, 0], 200), wall('b', [1000, 0], [2000, 0], 100)]));
    expect(out).toHaveLength(1);
    expect(totalArea(out)).toBe(1000 * 200 + 1000 * 100);
  });

  it('反折（兩牆同向重疊）：視為平頭', () => {
    const out = wallOutline(level([wall('a', [0, 0], [1000, 0]), wall('b', [0, 0], [500, 0])]));
    expect(totalArea(out)).toBe(1000 * 100);
  });

  it('極銳角（5°）：不產生超過限制的尖刺', () => {
    const t = (5 * Math.PI) / 180;
    const out = wallOutline(
      level([
        wall('a', [0, 0], [1000, 0]),
        wall('b', [0, 0], [Math.round(1000 * Math.cos(t)), Math.round(1000 * Math.sin(t))]),
      ]),
    );
    const xs = out.flatMap((p) => p.outer.map((q) => q[0]));
    expect(Math.min(...xs)).toBeGreaterThan(-4 * 50 - 2);
  });

  it('近平行（0.5°）相接：視為共線平頭', () => {
    const t = (0.5 * Math.PI) / 180;
    const q = wallQuad(
      [
        wall('a', [0, 0], [1000, 0]),
        wall('b', [1000, 0], [1000 + Math.round(1000 * Math.cos(t)), Math.round(1000 * Math.sin(t))]),
      ],
      wall('a', [0, 0], [1000, 0]),
    );
    expect(q[1]).toEqual([1000, -50]);
  });

  it('極短牆與零長牆', () => {
    expect(wallOutline(level([wall('z', [5, 5], [5, 5])]))).toEqual([]);
    const out = wallOutline(level([wall('s', [0, 0], [1, 0], 20)]));
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('自交（兩牆 X 交叉＋封閉）：輸出封閉且為整數座標', () => {
    const out = wallOutline(
      level([wall('a', [0, 0], [1000, 1000]), wall('b', [0, 1000], [1000, 0]), wall('c', [0, 0], [0, 1000])]),
    );
    for (const p of out)
      for (const v of p.outer) expect(Number.isInteger(v[0]) && Number.isInteger(v[1])).toBe(true);
  });

  it('property：平移不改變輪廓面積；輪廓封閉（≥3 點）且外框逆時針', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 8000 }),
        fc.integer({ min: 500, max: 8000 }),
        fc.integer({ min: 20, max: 300 }),
        fc.integer({ min: -50000, max: 50000 }),
        fc.integer({ min: -50000, max: 50000 }),
        (w, h, t, dx, dy) => {
          const thick = Math.min(t, Math.floor(Math.min(w, h) / 3));
          const base = wallOutline(level(rect(0, 0, w, h, thick)));
          const moved = wallOutline(level(rect(dx, dy, dx + w, dy + h, thick)));
          expect(Math.abs(totalArea(base) - totalArea(moved))).toBeLessThanOrEqual(4);
          for (const p of moved) {
            expect(p.outer.length).toBeGreaterThanOrEqual(3);
            expect(signedArea(p.outer)).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('其他牆工具', () => {
  it('areCollinearJoined', () => {
    expect(areCollinearJoined(wall('a', [0, 0], [1000, 0]), wall('b', [1000, 0], [2000, 0]))).toBe(true);
    expect(areCollinearJoined(wall('a', [0, 0], [1000, 0]), wall('b', [2000, 0], [1000, 0]))).toBe(true);
    expect(areCollinearJoined(wall('a', [1000, 0], [0, 0]), wall('b', [0, 0], [-500, 0]))).toBe(true);
    expect(areCollinearJoined(wall('a', [1000, 0], [0, 0]), wall('b', [-500, 0], [0, 0]))).toBe(true);
    expect(areCollinearJoined(wall('a', [0, 0], [1000, 0]), wall('b', [1000, 0], [1000, 500]))).toBe(false);
    expect(areCollinearJoined(wall('a', [0, 0], [1000, 0]), wall('b', [3000, 0], [4000, 0]))).toBe(false);
  });
  it('openingSegment', () => {
    expect(openingSegment(wall('a', [0, 0], [0, 1000]), 100, 300)).toEqual([
      [0, 100],
      [0, 400],
    ]);
  });
});
