import { describe, expect, it } from 'vitest';
import type { Level, Wall } from '@interiorai/scene-schema';
import {
  exteriorDimensionChains,
  mergeWallPair,
  offsetPolygon,
  snapToWall,
  splitWallAt,
  subtractPolygons,
  subtractToPolygons,
} from '../src/index.js';

const W = (id: string, a: [number, number], b: [number, number], thickness = 100): Wall => ({
  id,
  a,
  b,
  thickness,
});
const lvl = (walls: Wall[], openings: Level['openings'] = []): Level => ({
  id: 'lvl_1',
  elevation: 0,
  height: 2800,
  walls,
  openings,
  rooms: [],
  objects: [],
});

describe('splitWallAt / mergeWallPair（牆分割合併，FE-PLAN-15）', () => {
  const level = lvl(
    [W('w_1', [0, 0], [4000, 0])],
    [{ id: 'o_1', wallId: 'w_1', type: 'window', offset: 2500, width: 800, height: 1200 }],
  );
  it('分割：兩段＋開口歸屬', () => {
    const r = splitWallAt(level, 'w_1', 2000, 'w_2');
    expect(r.violations).toEqual([]);
    expect(r.level.walls.map((w) => [w.id, w.a, w.b])).toEqual([
      ['w_1', [0, 0], [2000, 0]],
      ['w_2', [2000, 0], [4000, 0]],
    ]);
    expect(r.level.openings[0]).toMatchObject({ wallId: 'w_2', offset: 500 });
  });
  it('分割的錯誤：找不到牆、太短、落在門窗上', () => {
    expect(splitWallAt(level, 'nope', 2000, 'x').violations[0]!.code).toBe('WALL_NOT_FOUND');
    expect(splitWallAt(level, 'w_1', 50, 'x').violations[0]!.code).toBe('WALL_TOO_SHORT');
    expect(splitWallAt(level, 'w_1', 2800, 'x').violations[0]!.code).toBe('OPENING_OUT_OF_RANGE');
  });
  it('合併：共線相接 → 一面牆；不共線、有第三面牆相接 → null', () => {
    const split = splitWallAt(level, 'w_1', 2000, 'w_2').level;
    const m = mergeWallPair(split, 'w_1', 'w_2')!;
    expect(m.walls).toHaveLength(1);
    expect(m.openings[0]).toMatchObject({ offset: 2500 });
    expect(mergeWallPair(split, 'w_1', 'missing')).toBeNull();
    const bent = lvl([W('a', [0, 0], [2000, 0]), W('b', [2000, 0], [2000, 2000])]);
    expect(mergeWallPair(bent, 'a', 'b')).toBeNull();
    const tee = lvl([...split.walls, W('c', [2000, 0], [2000, 1500])]);
    expect(mergeWallPair(tee, 'w_1', 'w_2')).toBeNull();
  });
});

describe('多邊形布林（樓板開口）', () => {
  const sq: [number, number][] = [
    [0, 0],
    [4000, 0],
    [4000, 4000],
    [0, 4000],
  ];
  const hole: [number, number][] = [
    [1000, 1000],
    [2000, 1000],
    [2000, 2000],
    [1000, 2000],
  ];
  it('完全在內部的開口成為洞；跨邊的開口切掉外框', () => {
    const p = subtractToPolygons(sq, [hole]);
    expect(p).toHaveLength(1);
    expect(p[0]!.holes).toHaveLength(1);
    const edge = subtractToPolygons(sq, [
      [
        [-500, 1000],
        [1000, 1000],
        [1000, 2000],
        [-500, 2000],
      ],
    ]);
    expect(edge[0]!.holes).toHaveLength(0);
    expect(subtractPolygons(sq, [hole]).length).toBeGreaterThan(0);
  });
  it('偏移：空輸入、斜接', () => {
    expect(offsetPolygon([], 100)).toEqual([]);
    expect(offsetPolygon([sq], 100, false)[0]!.length).toBe(4);
  });
});

describe('自動外部尺寸的邊界情況', () => {
  it('沒有封閉房間 → 空；斜牆不標註', () => {
    expect(exteriorDimensionChains({ walls: [W('a', [0, 0], [1000, 0])], openings: [] })).toEqual([]);
    const tri = {
      walls: [W('a', [0, 0], [4000, 0]), W('b', [4000, 0], [0, 4000]), W('c', [0, 4000], [0, 0])],
      openings: [],
    };
    const sides = new Set(exteriorDimensionChains(tri).map((c) => c.side));
    expect(sides.has('top')).toBe(true);
    expect(sides.has('left')).toBe(true);
    expect(sides.has('right')).toBe(false);
  });
});

describe('snapToWall 邊界', () => {
  it('離牆太遠或在牆端 → null', () => {
    const level = { walls: [W('a', [0, 0], [4000, 0])] };
    expect(snapToWall(level as never, [2000, 3000], 500, 200)).toBeNull();
    expect(snapToWall(level as never, [-100, 300], 500, 200)).toBeNull();
    expect(snapToWall(level as never, [2000, 320], 500, 200)).not.toBeNull();
  });
});
