import { describe, expect, it } from 'vitest';
import { featherMask, labToRgb, resolveRequest, restylePixels, rgbToLab } from '../src/ai/photoStyle';

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      a.set([r, g, b, 255], (y * w + x) * 4);
    }
  return a;
};
const mean = (a: Uint8ClampedArray, c: number) => {
  let s = 0;
  for (let i = c; i < a.length; i += 4) s += a[i]!;
  return s / (a.length / 4);
};

describe('照片換風格（本機預覽）', () => {
  it('Lab 往返誤差 ≤ 1', () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [200, 120, 40],
      [30, 90, 200],
    ] as const) {
      const [R, G, B] = labToRgb(...rgbToLab(r, g, b));
      expect(Math.abs(R - r) + Math.abs(G - g) + Math.abs(B - b)).toBeLessThanOrEqual(3);
    }
  });
  it('提示詞覆寫風格與暖度；變化序號改變強度', () => {
    expect(resolveRequest({ style: 'modern', prompt: '日式溫暖的客廳' }).style).toBe('japandi');
    expect(resolveRequest({ style: 'modern', prompt: 'warm' }).warmth).toBeGreaterThan(
      resolveRequest({ style: 'modern' }).warmth,
    );
    expect(resolveRequest({ style: 'nordic', variant: 1 }).strength).not.toBe(
      resolveRequest({ style: 'nordic', variant: 2 }).strength,
    );
  });
  it('工業風把藍色照片拉向暖灰、明暗順序保留', () => {
    const src = img(32, 32, (x) => [40 + x * 4, 80 + x * 3, 200]);
    const out = restylePixels(src, 32, 32, { style: 'industrial' });
    expect(mean(out, 2)).toBeLessThan(mean(src, 2)); // 藍減少
    // 左暗右亮的關係不變
    expect(out[(16 * 32 + 30) * 4]! + out[(16 * 32 + 30) * 4 + 1]!).toBeGreaterThan(
      out[(16 * 32 + 1) * 4]! + out[(16 * 32 + 1) * 4 + 1]!,
    );
  });
  it('遮罩外不變（局部重繪）', () => {
    const src = img(40, 20, () => [60, 120, 200]);
    const mask = new Uint8Array(40 * 20);
    for (let y = 0; y < 20; y++) for (let x = 25; x < 40; x++) mask[y * 40 + x] = 255;
    const out = restylePixels(src, 40, 20, { style: 'classic' }, mask);
    expect(Array.from(out.slice(0, 4))).toEqual([60, 120, 200, 255]);
    expect(Array.from(out.slice((10 * 40 + 39) * 4, (10 * 40 + 39) * 4 + 3))).not.toEqual([60, 120, 200]);
  });
  it('羽化遮罩值域 0–1 且邊緣平滑', () => {
    const m = new Uint8Array(20 * 1);
    m.fill(255, 10);
    const f = featherMask(m, 20, 1, 3);
    expect(f[0]).toBeCloseTo(0, 5);
    expect(f[19]).toBeCloseTo(1, 5);
    expect(f[10]!).toBeGreaterThan(0.2);
    expect(f[10]!).toBeLessThan(0.8);
  });
});

import { inpaintPixels } from '../src/ai/photoStyle';
describe('虛擬清空（FE-AI-04 本機預覽）', () => {
  it('遮罩內的家具被周圍牆色填滿；遮罩外不變', () => {
    const W = 40;
    const H = 30;
    const a = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) a.set([220, 210, 190, 255], i * 4);
    for (let y = 10; y < 20; y++) for (let x = 15; x < 25; x++) a.set([60, 40, 30, 255], (y * W + x) * 4);
    const mask = new Uint8Array(W * H);
    for (let y = 9; y < 21; y++) for (let x = 14; x < 26; x++) mask[y * W + x] = 255;
    const out = inpaintPixels(a, W, H, mask);
    const c = (15 * W + 20) * 4;
    expect(Math.abs(out[c]! - 220)).toBeLessThan(8);
    expect(Array.from(out.slice(0, 4))).toEqual([220, 210, 190, 255]);
  });
});
