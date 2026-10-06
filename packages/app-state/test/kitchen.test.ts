import { describe, expect, it } from 'vitest';
import { createCatalog, objectDims, SEED_CATALOG } from '@interiorai/catalog';
import { objectFootprint, overlapArea } from '@interiorai/core-geometry';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addOpening,
  addRectRoom,
  autoDecorate,
  createEditorStore,
  planBath,
  planKitchen,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const typeOf = (id: string) => {
  const e = catalog.get(id);
  return e?.model.kind === 'parametric' ? e.model.type : '';
};
const kitchen = () => {
  const store = createEditorStore();
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], [3600, 3000]));
  const lv = activeLevel(store.getState());
  const south = lv.walls.find((w) => w.a[1] === 0 && w.b[1] === 0)!;
  const north = lv.walls.find((w) => w.a[1] === 3000 && w.b[1] === 3000)!;
  s.exec(
    addOpening(s.levelId, { wallId: south.id, type: 'door', offset: 300, width: 900, height: 2100, sill: 0 }),
  );
  s.exec(
    addOpening(s.levelId, {
      wallId: north.id,
      type: 'window',
      offset: 1300,
      width: 1000,
      height: 1000,
      sill: 1000,
    }),
  );
  return store;
};

describe('planKitchen / planBath', () => {
  for (const shape of ['I', 'L', 'U'] as const)
    it(`${shape} 型：水槽／爐台／冰箱各一、下櫃不重疊、不擋門、場景合法`, () => {
      const store = kitchen();
      const s = store.getState();
      const lv = activeLevel(s);
      const room = lv.rooms[0]!;
      const pl = planKitchen(lv, catalog, room.id, shape);
      const types = pl.map((p) => typeOf(p.catalogId));
      expect(types.filter((t) => t === 'sink')).toHaveLength(1);
      expect(types.filter((t) => t === 'stove')).toHaveLength(1);
      expect(types.filter((t) => t === 'fridge')).toHaveLength(1);
      const floor = pl.filter((p) => p.position[1] === 0);
      const polys = floor.map((p) => {
        const d = objectDims(catalog.get(p.catalogId)!, p.params);
        return objectFootprint(p.position, p.rotationY, d.w, d.d);
      });
      for (let i = 0; i < polys.length; i++)
        for (let j = i + 1; j < polys.length; j++)
          expect(overlapArea(polys[i]!, polys[j]!)).toBeLessThan(2000);
      // 門（x 300–1200，z≈0）前沒有下櫃
      expect(floor.some((p) => p.position[2] < 700 && p.position[0] > 200 && p.position[0] < 1300)).toBe(
        false,
      );
      expect(s.exec(autoDecorate(s.levelId, pl))).toBe(true);
      expect(validateScene(store.getState().scene).ok).toBe(true);
      if (shape !== 'I')
        expect(new Set(floor.map((p) => p.rotationY.toFixed(2))).size).toBeGreaterThanOrEqual(2);
    });
  it('水槽在窗下（北牆 x 1300–2300）', () => {
    const lv = activeLevel(kitchen().getState());
    const sink = planKitchen(lv, catalog, lv.rooms[0]!.id, 'I').find((p) => typeOf(p.catalogId) === 'sink');
    expect(sink && sink.position[2] > 2000 && sink.position[0] > 1200 && sink.position[0] < 2400).toBe(true);
  });
  it('衛浴：洗手台、鏡子、馬桶，另一側淋浴或浴缸', () => {
    const store = createEditorStore();
    const s = store.getState();
    s.exec(addRectRoom(s.levelId, [0, 0], [2400, 1800]));
    const lv = activeLevel(store.getState());
    const types = planBath(lv, catalog, lv.rooms[0]!.id).map((p) => typeOf(p.catalogId));
    expect(types).toEqual(expect.arrayContaining(['basin', 'toilet', 'mirror']));
    expect(types.some((t) => t === 'shower' || t === 'bathtub')).toBe(true);
  });
});
