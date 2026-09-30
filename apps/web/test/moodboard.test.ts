import { describe, expect, it } from 'vitest';
import { materialMap } from '@interiorai/catalog';
import { catalog, materials } from '../src/catalogData';
import { extractPalette, inferStyles, recommendAssets } from '../src/ai/moodboard';

const img = (colors: [number, number, number, number][]) => {
  const out: number[] = [];
  for (const [r, g, b, n] of colors) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return Uint8ClampedArray.from(out);
};

describe('moodboard', () => {
  it('色盤依佔比排序、顏色接近原色', () => {
    const p = extractPalette(
      img([
        [240, 238, 232, 600],
        [60, 90, 70, 300],
        [200, 160, 110, 100],
      ]),
      3,
    );
    expect(p).toHaveLength(3);
    expect(p[0]!.weight).toBeCloseTo(0.6, 1);
    expect(p[0]!.hex).toBe('#f0eee8');
  });
  it('淺色低彩 → 北歐；深色＋寶石色 → 輕奢／工業', () => {
    const light = inferStyles(
      extractPalette(
        img([
          [244, 243, 240, 700],
          [210, 214, 218, 300],
        ]),
        2,
      ),
    );
    expect(light[0]!.style).toBe('nordic');
    const dark = inferStyles(
      extractPalette(
        img([
          [25, 60, 45, 500],
          [30, 30, 32, 400],
          [180, 140, 60, 100],
        ]),
        3,
      ),
    );
    expect(['luxury', 'industrial']).toContain(dark[0]!.style);
  });
  it('推薦資產符合風格', () => {
    const recs = recommendAssets(
      catalog.all(),
      materialMap(materials),
      [{ hex: '#e8e2d8', weight: 1 }],
      ['nordic'],
    );
    expect(recs.length).toBe(12);
    expect(recs.filter((e) => e.styleTags.includes('nordic')).length).toBeGreaterThan(8);
  });
});
