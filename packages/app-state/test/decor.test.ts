import { describe, expect, it } from 'vitest';
import { createCatalog, objectDims, SEED_CATALOG } from '@interiorai/catalog';
import { objectFootprint, overlapArea, pointInPolygon, detectRooms } from '@interiorai/core-geometry';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addObject,
  addOpening,
  addRectRoom,
  autoDecorate,
  createEditorStore,
  planDecor,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const typeOf = (id: string) => {
  const e = catalog.get(id);
  return e?.model.kind === 'parametric' ? e.model.type : undefined;
};

const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], [5000, 4000]));
  const south = activeLevel(store.getState()).walls.find((w) => w.a[1] === 0 && w.b[1] === 0)!;
  s.exec(
    addOpening(s.levelId, { wallId: south.id, type: 'door', offset: 200, width: 900, height: 2100, sill: 0 }),
  );
  s.exec(addObject(s.levelId, { catalogId: 'sofa_3seat_a', position: [2500, 0, 3400], rotationY: Math.PI }));
  return store;
};

describe('planDecor / autoDecorate', () => {
  it('客廳：補上盆栽、地毯、落地燈，全部在房內、不擋門、不與家具重疊', () => {
    const store = setup();
    const lv = activeLevel(store.getState());
    const plan = planDecor(lv, catalog);
    const floorItems = plan.filter((p) => catalog.get(p.catalogId)!.anchor === 'floor');
    expect(floorItems.map((p) => typeOf(p.catalogId)).sort()).toEqual(['lamp_floor', 'plant', 'rug']);
    // 5000×4000 的房間沒有天花燈 → 約 1.8 m 間距的崁燈 3×2，貼天花板
    const downs = plan.filter((p) => typeOf(p.catalogId) === 'lamp_downlight');
    expect(downs).toHaveLength(6);
    expect(new Set(downs.map((p) => p.position[1]))).toEqual(new Set([2800 - 60]));
    const floor = detectRooms(lv).rooms[0]!.floor;
    const fp = (p: { catalogId: string; position: number[]; rotationY: number }) => {
      const d = objectDims(catalog.get(p.catalogId)!);
      return objectFootprint(p.position, p.rotationY, d.w, d.d);
    };
    const sofa = fp(lv.objects[0]!);
    for (const p of floorItems) {
      expect(fp(p).every((q) => pointInPolygon(q, floor))).toBe(true);
      // 門中心在 (650, 0)
      expect(Math.hypot(p.position[0] - 650, p.position[2])).toBeGreaterThan(1000);
      if (typeOf(p.catalogId) !== 'rug') expect(overlapArea(fp(p), sofa)).toBeLessThan(100);
    }
  });

  it('單一 undo 步驟；再規劃一次不會重複加', () => {
    const store = setup();
    const s = store.getState();
    const before = activeLevel(s).objects.length;
    const plan = planDecor(activeLevel(s), catalog);
    expect(store.getState().exec(autoDecorate(s.levelId, plan))).toBe(true);
    const after = store.getState();
    expect(activeLevel(after).objects.length).toBe(before + plan.length);
    expect(validateScene(after.scene).ok).toBe(true);
    expect(planDecor(activeLevel(after), catalog)).toEqual([]);
    after.undo();
    expect(activeLevel(store.getState()).objects.length).toBe(before);
  });

  it('沒有沙發的房間只放盆栽（加崁燈）', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    s.exec(addRectRoom(s.levelId, [0, 0], [3000, 3000]));
    const plan = planDecor(activeLevel(store.getState()), catalog);
    expect(plan.map((p) => typeOf(p.catalogId)).filter((t) => t !== 'lamp_downlight')).toEqual(['plant']);
  });
});

describe('planDecor 燈具', () => {
  it('床頭櫃上放檯燈、辦公桌上放螢幕、外牆窗掛窗簾（面向室內）；已有天花燈的房間不加崁燈', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    s.exec(addRectRoom(s.levelId, [0, 0], [4000, 4000]));
    const north = activeLevel(store.getState()).walls.find((w) => w.a[1] === 4000 && w.b[1] === 4000)!;
    s.exec(
      addOpening(s.levelId, {
        wallId: north.id,
        type: 'window',
        offset: 1000,
        width: 1500,
        height: 1200,
        sill: 900,
      }),
    );
    s.exec(addObject(s.levelId, { catalogId: 'nightstand_a', position: [500, 0, 500], rotationY: 0 }));
    s.exec(
      addObject(s.levelId, { catalogId: 'desk_office_1400', position: [2000, 0, 2000], rotationY: Math.PI }),
    );
    s.exec(addObject(s.levelId, { catalogId: 'lamp_pendant_a', position: [2000, 2400, 2000], rotationY: 0 }));
    const plan = planDecor(activeLevel(store.getState()), catalog);
    const of = (t: string) => plan.filter((p) => typeOf(p.catalogId) === t);
    expect(of('lamp_downlight')).toHaveLength(0);
    expect(of('lamp_table')).toHaveLength(1);
    expect(of('lamp_table')[0]!.position).toEqual([500, 500, 500]);
    expect(of('monitor')).toHaveLength(1);
    expect(of('monitor')[0]!.position[1]).toBe(750);
    // 桌子 rotation π → 後緣在 +Z 側
    expect(of('monitor')[0]!.position[2]).toBeGreaterThan(2000);
    const c = of('curtain')[0]!;
    expect(c.position[2]).toBeLessThan(4000); // 室內側
    expect(Math.cos(c.rotationY)).toBeCloseTo(-1); // 正面朝 −Z（朝向室內）
    expect(c.params).toEqual({ w: 2100 });
    // 套用後再規劃 → 不重複
    s.exec(autoDecorate(s.levelId, plan));
    expect(
      planDecor(activeLevel(store.getState()), catalog).filter(
        (p) => catalog.get(p.catalogId)!.light || typeOf(p.catalogId) === 'curtain',
      ),
    ).toEqual([]);
  });
});
