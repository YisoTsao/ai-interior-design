import fc from 'fast-check';
import type { Scene } from '@interiorai/scene-schema';
import { describe, expect, it } from 'vitest';
import { computeBOM } from '../src/index.js';
import { level, rect } from './fixtures.js';

const scene = (n: number): Scene => ({
  schemaVersion: '1.0.0',
  units: 'mm',
  levels: [
    level(
      rect(0, 0, 4000, 3000).map((w, i) =>
        i === 0 ? { ...w, materialId: 'm_paint', materialIdB: 'm_tile' } : { ...w, materialId: 'm_paint' },
      ),
      {
        openings: [{ id: 'o1', wallId: 'w_s', type: 'door', offset: 500, width: 900, height: 2100 }],
        rooms: [
          { id: 'r1', wallIds: ['w_s', 'w_e', 'w_n', 'w_w'], floorMaterialId: 'm_oak' },
          { id: 'r2', wallIds: ['w_s', 'w_e', 'w_n'], floorMaterialId: 'm_x' },
          { id: 'r3', wallIds: ['w_s', 'w_e', 'w_n'] },
        ],
        objects: Array.from({ length: n }, (_, i) => ({
          id: `obj_${i}`,
          catalogId: i % 2 ? 'sofa_a' : 'chair_a',
          position: [0, 0, 0] as [number, number, number],
          rotationY: 0,
        })),
      },
    ),
  ],
});
const catalog = { get: (id: string) => (id === 'sofa_a' ? { id, unitPriceTwd: 20000 } : undefined) };

describe('computeBOM（骨架）', () => {
  it('物件計數、牆面扣開口、地板淨面積、價格加總', () => {
    const b = computeBOM(scene(3), catalog, { m_oak: { pricePerM2Twd: 3000 } });
    const get = (k: string) => b.lines.find((l) => l.key === k)!;
    expect(get('chair_a').quantity).toBe(2);
    expect(get('sofa_a')).toMatchObject({ quantity: 1, subtotalTwd: 20000 });
    // 牆面：(4000+3000+4000+3000)*2800 − 900*2100 = 37.31 m²（m_paint）
    expect(get('m_paint').quantity).toBeCloseTo(37.31, 2);
    expect(get('m_tile').quantity).toBeCloseTo((4000 * 2800 - 900 * 2100) / 1e6, 2);
    expect(get('m_oak').quantity).toBeCloseTo(11.31, 2);
    expect(b.totalTwd).toBe(20000 + Math.round(3000 * 11.31));
    expect(b.unpricedKeys.sort()).toEqual(['chair_a', 'm_paint', 'm_tile']);
  });
  it('property：物件數量加總 = 場景物件數', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const b = computeBOM(scene(n), catalog);
        const sum = b.lines.filter((l) => l.kind === 'object').reduce((s, l) => s + l.quantity, 0);
        expect(sum).toBe(n);
      }),
      { numRuns: 30 },
    );
  });
});
