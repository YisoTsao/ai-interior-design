import { describe, expect, it } from 'vitest';
import { snap } from '../src/snap.js';

describe('snap targets（FE-PLAN-13）', () => {
  const level = { walls: [{ id: 'w', a: [0, 0], b: [1000, 0], thickness: 100, type: 'partition' }] } as never;
  it('關閉端點與牆線 → 只剩格線', () => {
    const r = snap([5, 3], { level, tolerance: 50, gridMm: 100, targets: { endpoint: false, wall: false } });
    expect(r.kind).toBe('grid');
  });
  it('關閉格線 → 取整數 mm', () => {
    const r = snap([333.4, 777.7], { level, tolerance: 5, gridMm: 100, targets: { grid: false } });
    expect(r).toEqual({ point: [333, 778], kind: 'none' });
  });
  it('角度步進 45°', () => {
    const r = snap([1000, 950], {
      level: { walls: [] } as never,
      tolerance: 5,
      angleFrom: [0, 0],
      angleStepRad: Math.PI / 4,
    });
    expect(r.kind).toBe('angle');
    expect(Math.abs(r.point[0] - r.point[1])).toBeLessThanOrEqual(1);
  });
});
