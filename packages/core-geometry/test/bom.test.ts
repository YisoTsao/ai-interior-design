import fc from 'fast-check';
import type { Scene } from '@interiorai/scene-schema';
import { describe, expect, it } from 'vitest';
import { computeBOM, defaultOpeningCatalogId, roomWallFaces, detectRooms } from '../src/index.js';
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
    expect(b.unpricedKeys.sort()).toEqual(['chair_a', 'door_single_900', 'm_paint', 'm_tile']);
    expect(get('door_single_900')).toMatchObject({ kind: 'opening', quantity: 1 });
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

/** 兩房：0..4000 × 0..3000，x=2000 隔間（T 接點）；外牆 A 面（逆時針 → 室內側）m_in、B 面 m_out */
const twoRooms = (objs: [number, number][] = [], dx = 0, dz = 0): Scene => {
  const walls = rect(dx, dz, dx + 4000, dz + 3000).map((w) => ({
    ...w,
    materialId: 'm_in',
    materialIdB: 'm_out',
  }));
  walls.push({
    id: 'w_mid',
    a: [dx + 2000, dz],
    b: [dx + 2000, dz + 3000],
    thickness: 100,
    materialId: 'm_mid',
  });
  return {
    schemaVersion: '1.0.0',
    units: 'mm',
    levels: [
      level(walls, {
        openings: [
          { id: 'o_door', wallId: 'w_s', type: 'door', offset: 500, width: 900, height: 2100 },
          { id: 'o_win', wallId: 'w_n', type: 'window', offset: 2500, width: 1200, height: 1200, sill: 900 },
          { id: 'o_pass', wallId: 'w_mid', type: 'passage', offset: 1000, width: 800, height: 2100 },
        ],
        rooms: [
          {
            id: 'r_l',
            wallIds: ['w_s', 'w_mid', 'w_n', 'w_w'],
            floorMaterialId: 'm_oak',
            ceilingMaterialId: 'm_ceil',
          },
          { id: 'r_r', wallIds: ['w_s', 'w_e', 'w_n', 'w_mid'], floorMaterialId: 'm_oak' },
        ],
        objects: objs.map(([x, z], i) => ({
          id: `obj_${i}`,
          catalogId: 'chair_a',
          position: [dx + x, 0, dz + z] as [number, number, number],
          rotationY: 0,
        })),
      }),
    ],
  };
};
const prices = { get: (id: string) => ({ id, unitPriceTwd: id.length * 1000 }) };
const matPrices = {
  m_in: { pricePerM2Twd: 350 },
  m_out: { pricePerM2Twd: 300 },
  m_oak: { pricePerM2Twd: 3200 },
};

describe('computeBOM（P6 估價）', () => {
  it('預設門窗計價對應', () => {
    expect(defaultOpeningCatalogId({ type: 'door', width: 900, height: 2100 })).toBe('door_single_900');
    expect(defaultOpeningCatalogId({ type: 'door', width: 1500, height: 2100 })).toBe('door_double_1500');
    expect(defaultOpeningCatalogId({ type: 'window', width: 1800, height: 2100 })).toBe('window_1800');
    expect(defaultOpeningCatalogId({ type: 'window', width: 1200, height: 1200 })).toBe('window_1200');
    expect(defaultOpeningCatalogId({ type: 'passage', width: 800, height: 2100 })).toBeNull();
  });

  it('房間範圍：只算面向房間的牆面（A/B 側正確）、扣開口、地板與天花', () => {
    const b = computeBOM(
      twoRooms([
        [1000, 1500],
        [3000, 1500],
      ]),
      prices,
      matPrices,
      { roomId: 'r_l' },
    );
    const get = (k: string) => b.lines.find((l) => l.key === k);
    // 淨地板 1900×2900；外牆面向室內的是 A 面（m_in）：1900（南）+2900（西）+1900（北）；隔間 m_mid 2900
    expect(get('m_oak')!.quantity).toBeCloseTo((1900 * 2900) / 1e6, 2);
    expect(get('m_ceil')!.quantity).toBeCloseTo((1900 * 2900) / 1e6, 2);
    const inArea = (1900 + 2900 + 1900) * 2800 - 900 * 2100 - 1200 * 1200;
    expect(get('m_in')!.quantity).toBeCloseTo(inArea / 1e6, 2);
    expect(get('m_mid')!.quantity).toBeCloseTo((2900 * 2800 - 800 * 2100) / 1e6, 2);
    expect(get('m_out')).toBeUndefined();
    expect(get('chair_a')!.quantity).toBe(1);
    expect(get('door_single_900')!.quantity).toBe(1);
    expect(get('window_1200')!.quantity).toBe(1);
    // 右房：沒有門窗（都在左半段）
    const r = computeBOM(twoRooms(), prices, matPrices, { roomId: 'r_r' });
    expect(r.lines.filter((l) => l.kind === 'opening')).toEqual([]);
  });

  it('找不到房間 → 丟錯', () => {
    expect(() => computeBOM(twoRooms(), prices, {}, { roomId: 'nope' })).toThrow(/找不到房間/);
  });

  it('roomWallFaces：牆面數＝淨地板邊數，面積非負', () => {
    const lv = twoRooms().levels[0]!;
    for (const d of detectRooms(lv).rooms) {
      const faces = roomWallFaces(lv, d);
      expect(faces.length).toBe(d.floor.length);
      for (const f of faces) expect(f.areaMm2).toBeGreaterThanOrEqual(0);
    }
  });

  const pts = fc.array(
    fc
      .tuple(fc.integer({ min: 100, max: 3900 }), fc.integer({ min: 100, max: 2900 }))
      .filter(([x]) => Math.abs(x - 2000) > 60),
    { maxLength: 20 },
  );

  it('property：總價 = Σ 小計；小計 = round(單價×數量)', () => {
    fc.assert(
      fc.property(pts, (p) => {
        const b = computeBOM(twoRooms(p), prices, matPrices);
        expect(b.totalTwd).toBe(b.lines.reduce((s, l) => s + (l.subtotalTwd ?? 0), 0));
        for (const l of b.lines)
          if (l.unitPriceTwd !== undefined)
            expect(l.subtotalTwd).toBe(Math.round(l.unitPriceTwd * l.quantity));
      }),
      { numRuns: 30 },
    );
  });

  it('property：平移整個場景，BOM 不變', () => {
    fc.assert(
      fc.property(
        pts,
        fc.integer({ min: -50000, max: 50000 }),
        fc.integer({ min: -50000, max: 50000 }),
        (p, dx, dz) => {
          expect(computeBOM(twoRooms(p, dx, dz), prices, matPrices)).toEqual(
            computeBOM(twoRooms(p), prices, matPrices),
          );
          expect(computeBOM(twoRooms(p, dx, dz), prices, matPrices, { roomId: 'r_l' })).toEqual(
            computeBOM(twoRooms(p), prices, matPrices, { roomId: 'r_l' }),
          );
        },
      ),
      { numRuns: 20 },
    );
  });

  it('property：各房間的物件與地板加總 = 專案範圍', () => {
    fc.assert(
      fc.property(pts, (p) => {
        const s = twoRooms(p);
        const all = computeBOM(s, prices, matPrices);
        const rooms = ['r_l', 'r_r'].map((roomId) => computeBOM(s, prices, matPrices, { roomId }));
        const q = (b: typeof all, kind: string, key: string) =>
          b.lines.filter((l) => l.kind === kind && l.key === key).reduce((x, l) => x + l.quantity, 0);
        expect(rooms.reduce((x, b) => x + q(b, 'object', 'chair_a'), 0)).toBe(p.length);
        expect(q(all, 'object', 'chair_a')).toBe(p.length);
        expect(rooms.reduce((x, b) => x + q(b, 'floor_finish', 'm_oak'), 0)).toBeCloseTo(
          q(all, 'floor_finish', 'm_oak'),
          1,
        );
      }),
      { numRuns: 30 },
    );
  });
});
