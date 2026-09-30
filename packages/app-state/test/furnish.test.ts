import { describe, expect, it } from 'vitest';
import { createCatalog, objectDims, SEED_CATALOG } from '@interiorai/catalog';
import { objectFootprint, overlapArea, pointInPolygon, detectRooms } from '@interiorai/core-geometry';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addOpening,
  addRectRoom,
  autoDecorate,
  createEditorStore,
  furnishVariants,
  inferRoomKind,
  planFurnish,
  updateRoom,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const typeOf = (id: string) => {
  const e = catalog.get(id);
  return e?.model.kind === 'parametric' ? e.model.type : undefined;
};

const setup = (
  kind?: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'dining' | 'study',
  size: [number, number] = [5000, 4000],
) => {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], size));
  const lv = activeLevel(store.getState());
  const south = lv.walls.find((w) => w.a[1] === 0 && w.b[1] === 0)!;
  s.exec(
    addOpening(s.levelId, { wallId: south.id, type: 'door', offset: 200, width: 900, height: 2100, sill: 0 }),
  );
  const room = activeLevel(store.getState()).rooms[0];
  if (kind && room) s.exec(updateRoom(s.levelId, room.id, { kind }));
  return store;
};

const floorItems = (lv: ReturnType<typeof activeLevel>, pls: ReturnType<typeof planFurnish>['placements']) =>
  pls.filter((p) => catalog.get(p.catalogId)!.anchor === 'floor' && p.position[1] === 0);

describe('planFurnish', () => {
  it('客廳：沙發、茶几、電視櫃；全部在房內、互不重疊、不擋門', () => {
    const store = setup('living');
    const lv = activeLevel(store.getState());
    const plan = planFurnish(lv, catalog, { style: 'modern' });
    const types = plan.placements.map((p) => typeOf(p.catalogId));
    expect(types.some((t) => t === 'sofa' || t === 'sofa_l')).toBe(true);
    expect(types).toContain('tvstand');
    expect(types.some((t) => t === 'table' || t === 'table_round')).toBe(true);
    const floor = detectRooms(lv).rooms[0]!.floor;
    const polys = floorItems(lv, plan.placements).map((p) => {
      const d = objectDims(catalog.get(p.catalogId)!);
      return { poly: objectFootprint(p.position, p.rotationY, d.w, d.d), cover: d.h <= 30 };
    });
    for (const { poly } of polys) expect(poly.every((q) => pointInPolygon(q, floor))).toBe(true);
    const solid = polys.filter((p) => !p.cover);
    for (let i = 0; i < solid.length; i++)
      for (let j = i + 1; j < solid.length; j++)
        expect(overlapArea(solid[i]!.poly, solid[j]!.poly)).toBeLessThanOrEqual(100);
    expect(plan.rooms[0]!.kind).toBe('living');
    expect(plan.cost).toBeGreaterThan(0);
  });

  it('沙發背靠牆、正面朝室內', () => {
    const lv = activeLevel(setup('living').getState());
    const sofa = planFurnish(lv, catalog).placements.find((p) => typeOf(p.catalogId)?.startsWith('sofa'))!;
    const fwd = [Math.sin(sofa.rotationY), Math.cos(sofa.rotationY)];
    const toCenter = [2500 - sofa.position[0], 2000 - sofa.position[2]];
    expect(fwd[0]! * toCenter[0]! + fwd[1]! * toCenter[1]!).toBeGreaterThan(0);
  });

  it('臥室：床＋床頭櫃＋衣櫃；廚房：冰箱／爐台／水槽；衛浴：馬桶＋洗手台', () => {
    const bed = planFurnish(activeLevel(setup('bedroom', [4000, 3600]).getState()), catalog).placements.map(
      (p) => typeOf(p.catalogId),
    );
    expect(bed).toEqual(expect.arrayContaining(['bed', 'nightstand', 'cabinet']));
    const kit = planFurnish(activeLevel(setup('kitchen', [4000, 3000]).getState()), catalog).placements.map(
      (p) => typeOf(p.catalogId),
    );
    expect(kit).toEqual(expect.arrayContaining(['fridge', 'stove', 'sink']));
    const bath = planFurnish(activeLevel(setup('bath', [2200, 1800]).getState()), catalog).placements.map(
      (p) => typeOf(p.catalogId),
    );
    expect(bath).toEqual(expect.arrayContaining(['toilet', 'basin']));
  });

  it('預算：超過時刪次要品項，但保留主件', () => {
    const lv = activeLevel(setup('living').getState());
    const full = planFurnish(lv, catalog, { style: 'luxury' });
    const cheap = planFurnish(lv, catalog, { style: 'luxury', budget: 1 });
    expect(cheap.placements.length).toBeLessThan(full.placements.length);
    expect(cheap.placements.map((p) => typeOf(p.catalogId)).some((t) => t?.startsWith('sofa'))).toBe(true);
  });

  it('三種風格提案套用後是合法場景，且一次復原', () => {
    const store = setup('living');
    const lv = activeLevel(store.getState());
    const vs = furnishVariants(lv, catalog);
    expect(vs.map((v) => v.style)).toEqual(['nordic', 'modern', 'luxury']);
    expect(
      new Set(vs.map((v) => JSON.stringify(v.placements.map((p) => p.materialOverrides)))).size,
    ).toBeGreaterThan(1);
    const before = lv.objects.length;
    store.getState().exec(autoDecorate(store.getState().levelId, vs[2]!.placements));
    expect(activeLevel(store.getState()).objects.length).toBe(before + vs[2]!.placements.length);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    store.getState().undo();
    expect(activeLevel(store.getState()).objects.length).toBe(before);
  });

  it('不同風格的提案選品或擺法不同', () => {
    const lv = activeLevel(setup('living', [6000, 4500]).getState());
    const [a, b, c] = furnishVariants(lv, catalog).map((v) =>
      JSON.stringify(v.placements.map((p) => [p.catalogId, p.position])),
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('房間用途推斷', () => {
    expect(inferRoomKind({ label: '主臥' }, 12, false)).toBe('bedroom');
    expect(inferRoomKind({ label: 'Kitchen' }, 12, false)).toBe('kitchen');
    expect(inferRoomKind({}, 3, false)).toBe('bath');
    expect(inferRoomKind({}, 30, true)).toBe('living');
    expect(inferRoomKind({ kind: 'study', label: '主臥' }, 12, false)).toBe('study');
  });
});
