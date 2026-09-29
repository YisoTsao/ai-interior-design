import { describe, expect, it } from 'vitest';
import { findCollisions, objectFootprint, overlapArea, polygonArea } from '../src/index.js';
import { level, rect } from './fixtures.js';

describe('collision（FR-304）', () => {
  it('footprint：旋轉 90° 後寬深互換，面積不變', () => {
    const f0 = objectFootprint([1000, 0, 1000], 0, 2000, 800);
    const f90 = objectFootprint([1000, 0, 1000], Math.PI / 2, 2000, 800);
    expect(polygonArea(f0)).toBeCloseTo(1_600_000);
    expect(polygonArea(f90)).toBeCloseTo(1_600_000);
    const xs = f90.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(800);
  });
  it('overlapArea', () => {
    const a = objectFootprint([0, 0, 0], 0, 1000, 1000);
    const b = objectFootprint([500, 0, 0], 0, 1000, 1000);
    expect(overlapArea(a, b)).toBeCloseTo(500_000, -2);
    expect(overlapArea(a, objectFootprint([5000, 0, 0], 0, 100, 100))).toBe(0);
  });
  it('穿牆、物件重疊、貼牆不誤報、牆/天花錨點略過', () => {
    const L = level(rect(0, 0, 4000, 3000));
    const fps = [
      { id: 'inside', poly: objectFootprint([2000, 0, 1500], 0, 1000, 600) },
      { id: 'through', poly: objectFootprint([0, 0, 1500], 0, 800, 600) },
      { id: 'touch', poly: objectFootprint([2000, 0, 50 + 300], 0, 1000, 600) },
      { id: 'overlap', poly: objectFootprint([2300, 0, 1500], 0, 1000, 600) },
      { id: 'lamp', poly: objectFootprint([2000, 0, 1500], 0, 500, 500), anchor: 'ceiling' as const },
      { id: 'win', poly: objectFootprint([0, 0, 1500], 0, 800, 80), anchor: 'wall' as const },
      { id: 'rug', poly: objectFootprint([2000, 0, 1500], 0, 2000, 1400), floorCovering: true },
    ];
    const w = findCollisions(L, fps);
    expect(w.filter((x) => x.kind === 'wall').map((x) => x.objectId)).toEqual(['through']);
    const objs = w.filter((x) => x.kind === 'object').map((x) => [x.objectId, x.otherId].sort().join('+'));
    expect(objs).toContain('inside+overlap');
    expect(objs.some((s) => s.includes('lamp') || s.includes('rug'))).toBe(false);
  });
});
