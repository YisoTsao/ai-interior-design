import { describe, expect, it } from 'vitest';
import { activeLevel, createEditorStore, importPlan } from '@interiorai/app-state';
import { validateScene } from '@interiorai/scene-schema';
import {
  calibrate,
  imageTransform,
  joinEndpoints,
  pending,
  toImport,
  type PlanResult,
} from '../src/features/plan-review/geometry';

const px: PlanResult = {
  source: 'raster',
  units: 'px',
  scale: { mmPerPx: null, method: 'unknown', confidence: 0 },
  walls: [
    { id: 'w_0', a: [0, 0], b: [200, 1], thickness: 10, confidence: 0.9 },
    { id: 'w_1', a: [200, 0], b: [200, 150], thickness: 10, confidence: 0.9 },
    { id: 'w_2', a: [200, 150], b: [0, 150], thickness: 10, confidence: 0.9 },
    { id: 'w_3', a: [0, 150], b: [0, 0], thickness: 10, confidence: 0.4 },
    { id: 'w_x', a: [50, 50], b: [52, 51], thickness: 6, confidence: 0.3 },
  ],
  openings: [
    {
      id: 'op_0',
      wallId: 'w_0',
      type: 'door',
      offset: 40,
      width: 40,
      height: 2100,
      sill: 0,
      confidence: 0.9,
    },
    {
      id: 'op_1',
      wallId: 'w_2',
      type: 'window',
      offset: 60,
      width: 60,
      height: 1200,
      sill: 900,
      confidence: 0.5,
    },
  ],
  rooms: [
    {
      polygon: [
        [5, 5],
        [195, 5],
        [195, 145],
        [5, 145],
      ],
      label: '客廳',
      confidence: 0.9,
    },
  ],
  labels: [],
  image: { width: 400, height: 300, rotationDeg: 2, originPx: [100, 80] },
  warnings: [],
};

describe('plan-review geometry', () => {
  it('影像座標往返（含轉正與原點）', () => {
    const t = imageTransform(px);
    const p = t.toImage([123, 45]);
    const q = t.fromImage(p);
    expect(q[0]).toBeCloseTo(123, 6);
    expect(q[1]).toBeCloseTo(45, 6);
  });

  it('兩點校正：200 px 對應 6000 mm → 30 mm/px', () => {
    expect(calibrate([0, 0], [200, 0], 6000)).toBeCloseTo(30);
  });

  it('待確認清單＝信心 < 0.6 的元素', () => {
    expect(
      pending(px)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['op_1', 'w_3', 'w_x']);
  });

  it('轉成 Scene：直角吸附、外牆、略過刪除/太短的牆、房名、通過 Scene 驗證', () => {
    const data = toImport(px, 30, { orthogonal: true, removed: new Set(['w_x']) });
    expect(data.walls[0]!.a[1]).toBe(data.walls[0]!.b[1]); // 1px 歪斜被吸附成水平
    expect(data.walls.every((w) => w.exterior)).toBe(true);
    const store = createEditorStore();
    const s = store.getState();
    let skipped: unknown[] = [];
    s.exec(importPlan(s.levelId, data, (x) => (skipped = x)));
    const lv = activeLevel(store.getState());
    expect(lv.walls).toHaveLength(4);
    expect(lv.openings.map((o) => o.type).sort()).toEqual(['door', 'window']);
    expect(lv.openings.find((o) => o.type === 'door')!.width).toBe(1200);
    expect(lv.rooms).toHaveLength(1);
    expect(lv.rooms[0]!.label).toBe('客廳');
    expect(skipped).toEqual([]);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    // 單一 undo 步驟
    store.getState().undo();
    expect(activeLevel(store.getState()).walls).toHaveLength(0);
  });

  it('不合法的元素略過並回報，不中斷匯入', () => {
    const bad: PlanResult = {
      ...px,
      walls: [...px.walls.slice(0, 4), { id: 'w_s', a: [0, 0], b: [2, 0], thickness: 5, confidence: 0.9 }],
    };
    const store = createEditorStore();
    const s = store.getState();
    let skipped: { reason: string }[] = [];
    s.exec(
      importPlan(
        s.levelId,
        toImport(bad, 30, { orthogonal: false, removed: new Set() }),
        (x) => (skipped = x),
      ),
    );
    expect(skipped.map((x) => x.reason)).toContain('牆太短（< 10 cm）');
    expect(activeLevel(store.getState()).walls).toHaveLength(4);
  });
});

describe('接點修補', () => {
  it('差幾 mm 沒接上的 L/T 接點被接起來 → 房間可封閉', () => {
    const walls = [
      { key: 'a', a: [0, 0] as [number, number], b: [4000, 0] as [number, number], thickness: 200 },
      { key: 'b', a: [4040, 30] as [number, number], b: [4040, 3000] as [number, number], thickness: 200 },
      { key: 'c', a: [4000, 3000] as [number, number], b: [0, 3000] as [number, number], thickness: 200 },
      { key: 'd', a: [0, 2960] as [number, number], b: [0, 60] as [number, number], thickness: 200 },
    ];
    joinEndpoints(walls);
    const store = createEditorStore();
    const s = store.getState();
    s.exec(importPlan(s.levelId, { walls, openings: [], labels: [] }));
    expect(activeLevel(store.getState()).rooms).toHaveLength(1);
  });
});
