import { describe, expect, it } from 'vitest';
import { describe as desc, rank, similarity } from '../src/ai/imageSearch';

/** 白底上畫一個 (w×h) 色塊 */
const img = (W: number, H: number, bw: number, bh: number, c: [number, number, number], alpha = false) => {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = Math.abs(x - W / 2) < bw / 2 && Math.abs(y - H / 2) < bh / 2;
      const i = (y * W + x) * 4;
      a.set(inside ? [...c, 255] : alpha ? [0, 0, 0, 0] : [250, 250, 250, 255], i);
    }
  return a;
};

describe('以圖找物（FE-AST-09）', () => {
  const photoSofa = desc(img(200, 120, 160, 60, [150, 90, 50]), 200, 120);
  const thumbs = [
    { item: 'sofa_brown', d: desc(img(160, 160, 140, 55, [155, 95, 55], true), 160, 160, 'alpha') },
    { item: 'lamp_tall_brown', d: desc(img(160, 160, 30, 140, [150, 90, 50], true), 160, 160, 'alpha') },
    { item: 'sofa_blue', d: desc(img(160, 160, 140, 55, [40, 70, 160], true), 160, 160, 'alpha') },
  ];
  it('色彩與比例都相近者排第一', () => {
    const r = rank(photoSofa, thumbs);
    expect(r[0]!.item).toBe('sofa_brown');
    expect(r.at(-1)!.item).not.toBe('sofa_brown');
  });
  it('前景偵測：比例取色塊而非整張圖', () => {
    expect(photoSofa.aspect).toBeCloseTo(160 / 60, 0);
    expect(similarity(photoSofa, photoSofa)).toBeCloseTo(1, 5);
  });
});
