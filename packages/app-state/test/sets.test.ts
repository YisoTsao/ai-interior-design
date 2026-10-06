import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { validateScene } from '@interiorai/scene-schema';
import { activeLevel, createEditorStore, FURNITURE_SETS, placeSet, ungroupObjects } from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);

describe('placeSet', () => {
  it('所有套組的目錄項都存在', () => {
    for (const s of FURNITURE_SETS)
      for (const it of s.items) expect(catalog.get(it.catalogId), `${s.id}:${it.catalogId}`).toBeDefined();
  });
  it('放置後同一群組、相對位置保留（旋轉 90°）、一次 undo、可解散', () => {
    const store = createEditorStore();
    const s = store.getState();
    const set = FURNITURE_SETS.find((x) => x.id === 'dining4')!;
    const cmd = placeSet(s.levelId, set, [3000, 2000], Math.PI / 2);
    expect(s.exec(cmd)).toBe(true);
    const objs = activeLevel(store.getState()).objects;
    expect(objs).toHaveLength(set.items.length);
    expect(new Set(objs.map((o) => o.groupId))).toEqual(new Set([cmd.groupId]));
    const chair = objs.find((o) => o.id === cmd.ids[1])!;
    // 局部 (-350, -650) 旋轉 90° → 世界 (3000-650, 2000+350)
    expect(chair.position[0]).toBe(2350);
    expect(chair.position[2]).toBe(2350);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    expect(store.getState().exec(ungroupObjects(s.levelId, cmd.ids))).toBe(true);
    expect(activeLevel(store.getState()).objects.every((o) => !o.groupId)).toBe(true);
    store.getState().undo();
    store.getState().undo();
    expect(activeLevel(store.getState()).objects).toHaveLength(0);
  });
});
