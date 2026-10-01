import { describe, expect, it } from 'vitest';
import type { Wall } from '@interiorai/scene-schema';
import { exteriorDimensionChains } from '../src/index.js';

const W = (id: string, a: [number, number], b: [number, number], thickness = 200): Wall => ({
  id,
  a,
  b,
  thickness,
});

describe('exteriorDimensionChains（自動外部尺寸）', () => {
  // 6000×4000，中間一道隔間（x=3500），北牆一扇 1200 寬的窗
  const level = {
    walls: [
      W('n', [0, 0], [6000, 0]),
      W('e', [6000, 0], [6000, 4000]),
      W('s', [6000, 4000], [0, 4000]),
      W('w', [0, 4000], [0, 0]),
      W('p', [3500, 0], [3500, 4000], 100),
    ],
    openings: [{ id: 'o1', wallId: 'n', type: 'window' as const, offset: 1000, width: 1200, height: 1200 }],
  };
  const chains = exteriorDimensionChains(level);

  it('四個方向各有分段與總尺寸', () => {
    for (const side of ['top', 'bottom', 'left', 'right'])
      expect(
        chains
          .filter((c) => c.side === side)
          .map((c) => c.kind)
          .sort(),
      ).toEqual(['segments', 'total']);
  });
  it('總尺寸＝外緣到外緣（含牆厚）', () => {
    const top = chains.find((c) => c.side === 'top' && c.kind === 'total')!;
    expect(top.b[0] - top.a[0]).toBe(6200);
    const left = chains.find((c) => c.side === 'left' && c.kind === 'total')!;
    expect(left.b[1] - left.a[1]).toBe(4200);
  });
  it('分段：北面含窗的兩邊；尺寸線在外牆外側', () => {
    const top = chains.find((c) => c.side === 'top' && c.kind === 'segments')!;
    expect(top.ticks.map((p) => p[0])).toEqual([0, 1000, 2200, 6000]);
    expect(top.a[1]).toBeLessThan(-100);
    const bottom = chains.find((c) => c.side === 'bottom' && c.kind === 'segments')!;
    expect(bottom.a[1]).toBeGreaterThan(4100);
  });
  it('T 字接點在隔間牆中點時，隔間牆仍是內牆', () => {
    const lv = {
      walls: [
        W('n', [0, 0], [9000, 0]),
        W('e', [9000, 0], [9000, 8400]),
        W('s', [9000, 8400], [0, 8400]),
        W('w', [0, 8400], [0, 0]),
        W('p', [5200, 0], [5200, 8400], 100),
        W('q', [5200, 4200], [9000, 4200], 100),
      ],
      openings: [],
    };
    const right = exteriorDimensionChains(lv).find((c) => c.side === 'right' && c.kind === 'total')!;
    expect(right.a[0]).toBeGreaterThan(9100);
  });
  it('隔間牆不出現在外部尺寸', () => {
    const top = chains.find((c) => c.side === 'top' && c.kind === 'segments')!;
    expect(top.ticks.map((p) => p[0])).not.toContain(3500);
  });
});
