import { describe, expect, it } from 'vitest';
import { activeLevel, addObject, addRectRoom, createEditorStore, setMaterial } from '@interiorai/app-state';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { evaluate } from '../src/editor/achievements';

describe('成就（FE-UX-10）', () => {
  it('依場景狀態逐步解鎖', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    expect([...evaluate(store.getState().scene, '2d')]).toEqual([]);
    s.exec(addRectRoom(s.levelId, [0, 0], [4000, 3000]));
    expect(evaluate(store.getState().scene, '2d')).toEqual(new Set(['firstWall', 'firstRoom']));
    for (let i = 0; i < 5; i++)
      s.exec(
        addObject(s.levelId, { catalogId: 'lamp_floor_a', position: [500 + i * 400, 0, 1500], rotationY: 0 }),
      );
    const room = activeLevel(store.getState()).rooms[0]!;
    s.exec(setMaterial(s.levelId, { kind: 'floor', roomId: room.id }, 'stone_carrara_marble'));
    const got = evaluate(store.getState().scene, '3d', createCatalog(SEED_CATALOG));
    for (const a of ['furnished', 'material', 'lighting', 'view3d']) expect(got.has(a as never)).toBe(true);
  });
});
