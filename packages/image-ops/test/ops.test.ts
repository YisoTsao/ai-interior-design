import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canny,
  compositeOutsideMask,
  countOnes,
  decodeId,
  deterministicNoise,
  dilate,
  encodeId,
  fillRegion,
  gray,
  largestRegion,
  maskFromIds,
  maskToAlpha,
  resize,
  rgba,
  shift,
  structuralEdges,
  structureRecall,
  tauPx,
  toGray,
} from '../src/index.js';

/** 合成 G-buffer：背景＋幾個矩形物件（各自 id 與 clay 明暗），深度隨物件不同 */
function synth(w = 256, h = 192) {
  const clay = rgba(w, h);
  const ids = rgba(w, h);
  const depth = gray(w, h);
  const boxes = [
    { id: 11, x: 20, y: 30, w: 90, h: 70, v: 170, d: 120 },
    { id: 12, x: 140, y: 40, w: 80, h: 110, v: 90, d: 60 },
    { id: 13, x: 40, y: 120, w: 70, h: 50, v: 210, d: 200 },
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = 140;
      let id = 0;
      let d = 250;
      for (const b of boxes)
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) [v, id, d] = [b.v, b.id, b.d];
      clay.data.set([v, v, v, 255], i * 4);
      ids.data.set([...encodeId(id), 255], i * 4);
      depth.data[i] = d;
    }
  return { clay, ids, depth, w, h };
}

describe('objectId 編碼', () => {
  it('encode/decode 往返', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 24 - 1 }), (n) => decodeId(...encodeId(n)) === n));
  });
});

describe('結構驗證（05 §5、ADR-012）', () => {
  const s = synth();
  const ref = structuralEdges(s.ids, s.depth);
  const tau = tauPx(s.w, s.h);

  it('clay 本身的 recall ≈ 1', () => {
    expect(structureRecall(ref, canny(toGray(s.clay)), tau)).toBeGreaterThan(0.95);
  });

  it('mock ok（確定性雜訊）仍通過最嚴格門檻 0.90', () => {
    const out = deterministicNoise(s.clay, 42, 6);
    expect(structureRecall(ref, canny(toGray(out)), tau)).toBeGreaterThanOrEqual(0.9);
  });

  it('break_structure（平移 3τ＋刪最大物件）低於最寬鬆門檻 0.65', () => {
    const big = largestRegion(s.ids)!;
    expect(big).toBe(12);
    const broken = shift(fillRegion(s.clay, s.ids, big), 3 * tau, 3 * tau);
    expect(structureRecall(ref, canny(toGray(broken)), tau)).toBeLessThan(0.65);
  });

  it('確定性：同輸入同輸出', () => {
    const a = canny(toGray(deterministicNoise(s.clay, 7)));
    const b = canny(toGray(deterministicNoise(s.clay, 7)));
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('空的結構邊緣 → recall 1；尺寸不一致 → 例外', () => {
    expect(structureRecall(gray(4, 4), gray(4, 4), 1)).toBe(1);
    expect(() => structureRecall(gray(4, 4), gray(5, 4), 1)).toThrow();
  });
});

describe('遮罩與合成（B6.2）', () => {
  const s = synth();

  it('遮罩＝所選物件區域膨脹 3px；alpha 0 為要改的區域', () => {
    const m = maskFromIds(s.ids, [13], 3);
    expect(countOnes(m)).toBe((70 + 6) * (50 + 6));
    const a = maskToAlpha(m);
    const inside = (130 * s.w + 60) * 4 + 3;
    const outside = (5 * s.w + 5) * 4 + 3;
    expect([a.data[inside], a.data[outside]]).toEqual([0, 255]);
  });

  it('遮罩外像素逐位元不變（property）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.subarray([11, 12, 13], { minLength: 1 }),
        (seed, sel) => {
          const edited = deterministicNoise(
            rgba(s.w, s.h, new Uint8Array(s.w * s.h * 4).fill(seed % 256)),
            seed,
            40,
          );
          const m = maskFromIds(s.ids, sel, 2);
          const out = compositeOutsideMask(s.clay, edited, m);
          for (let i = 0; i < m.data.length; i++)
            if (!m.data[i])
              for (let c = 0; c < 4; c++) if (out.data[i * 4 + c] !== s.clay.data[i * 4 + c]) return false;
          return true;
        },
      ),
      { numRuns: 20 },
    );
  });

  it('編輯結果尺寸不同時先縮放', () => {
    const m = maskFromIds(s.ids, [11], 2);
    const out = compositeOutsideMask(s.clay, rgba(64, 48), m);
    expect([out.width, out.height]).toEqual([s.w, s.h]);
  });
});

describe('基本運算', () => {
  it('dilate 半徑 r 的方形', () => {
    const m = gray(9, 9);
    m.data[4 * 9 + 4] = 1;
    expect(countOnes(dilate(m, 2))).toBe(25);
    expect(countOnes(dilate(m, 0))).toBe(1);
  });
  it('resize 保持純色、尺寸正確', () => {
    const img = rgba(10, 10, new Uint8Array(400).fill(77));
    const r = resize(img, 23, 7);
    expect([r.width, r.height]).toEqual([23, 7]);
    expect(r.data.every((v) => v === 77)).toBe(true);
  });
});
