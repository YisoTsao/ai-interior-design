import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { addLevel, addObject, createEditorStore, stairOpenings } from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);

describe('樓梯自動開洞（FE-LVL-04）', () => {
  it('下層樓梯到達本層 → 本層有開口（佔地範圍）；最底層沒有', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    const first = s.levelId;
    s.exec(addObject(first, { catalogId: 'stairs_straight', position: [2000, 0, 3000], rotationY: 0 }));
    const add = addLevel({ name: '2F' });
    s.exec(add);
    const scene = store.getState().scene;
    const up = stairOpenings(scene, add.levelId, catalog);
    expect(up).toHaveLength(1);
    const xs = up[0]!.map((p) => p[0]);
    const zs = up[0]!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(1000);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(3600);
    expect(stairOpenings(scene, first, catalog)).toEqual([]);
  });
  it('矮樓梯（沒到上層）不開洞', () => {
    const store = createEditorStore({ projectName: 't' });
    const s = store.getState();
    s.exec(
      addObject(s.levelId, {
        catalogId: 'stairs_straight',
        position: [0, 0, 0],
        rotationY: 0,
        params: { h: 1500 },
      }),
    );
    const add = addLevel({ name: '2F' });
    s.exec(add);
    expect(stairOpenings(store.getState().scene, add.levelId, catalog)).toEqual([]);
  });
});
