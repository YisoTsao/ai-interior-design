import { describe, expect, it } from 'vitest';
import { offsetPolyline } from '../src/index.js';

describe('offsetPolyline（牆定位線）', () => {
  it('開放折線：左側平移，轉角斜接', () => {
    expect(
      offsetPolyline(
        [
          [0, 0],
          [1000, 0],
          [1000, 1000],
        ],
        100,
      ),
    ).toEqual([
      [0, 100],
      [900, 100],
      [900, 1000],
    ]);
  });
  it('右側（負值）', () => {
    expect(
      offsetPolyline(
        [
          [0, 0],
          [1000, 0],
        ],
        -50,
      ),
    ).toEqual([
      [0, -50],
      [1000, -50],
    ]);
  });
  it('封閉矩形：四角都斜接（逆時針往內縮）', () => {
    const sq: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ];
    expect(offsetPolyline(sq, 100, true)).toEqual([
      [100, 100],
      [900, 100],
      [900, 900],
      [100, 900],
    ]);
  });
  it('共線段與 d=0', () => {
    expect(
      offsetPolyline(
        [
          [0, 0],
          [500, 0],
          [1000, 0],
        ],
        10,
      ),
    ).toEqual([
      [0, 10],
      [500, 10],
      [1000, 10],
    ]);
    expect(
      offsetPolyline(
        [
          [0, 0],
          [1, 1],
        ],
        0,
      ),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});
