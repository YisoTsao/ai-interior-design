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
    expect(plan.map((p) => typeOf(p.catalogId)).sort()).toEqual(['lamp_floor', 'plant', 'rug']);
    const floor = detectRooms(lv).rooms[0]!.floor;
    const fp = (p: { catalogId: string; position: number[]; rotationY: number }) => {
      const d = objectDims(catalog.get(p.catalogId)!);
      return objectFootprint(p.position, p.rotationY, d.w, d.d);
    };
    const sofa = fp(lv.objects[0]!);
    for (const p of plan) {
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

  it('沒有沙發的房間只放盆栽', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    s.exec(addRectRoom(s.levelId, [0, 0], [3000, 3000]));
    const plan = planDecor(activeLevel(store.getState()), catalog);
    expect(plan.map((p) => typeOf(p.catalogId))).toEqual(['plant']);
  });
});
