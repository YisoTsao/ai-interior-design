import { describe, expect, it } from 'vitest';
import {
  activeLevel,
  addObject,
  addRectRoom,
  createEditorStore,
  diffScenes,
  restoreScene,
  transformObject,
} from '../src/index.js';

describe('diffScenes / restoreScene', () => {
  it('新增、移動、刪除、屬性變更；還原可 undo', () => {
    const store = createEditorStore();
    const s = store.getState();
    s.exec(addRectRoom(s.levelId, [0, 0], [4000, 3000]));
    s.exec(addObject(s.levelId, { catalogId: 'sofa_3seat_a', position: [2000, 0, 2000], rotationY: 0 }));
    const v1 = store.getState().scene;
    const sofa = activeLevel(store.getState()).objects[0]!;
    s.exec(transformObject(s.levelId, sofa.id, { position: [2500, 0, 2000] }));
    s.exec(addObject(s.levelId, { catalogId: 'plant_a', position: [300, 0, 300], rotationY: 0 }));
    const v2 = store.getState().scene;
    const d = diffScenes(v1, v2);
    expect(d.summary.objects).toEqual([1, 0, 1, 0]);
    expect(d.moved).toEqual([sofa.id]);
    const back = diffScenes(v2, v1);
    expect(back.summary.objects[1]).toBe(1);
    expect(store.getState().exec(restoreScene(v1))).toBe(true);
    expect(store.getState().scene).toEqual(v1);
    store.getState().undo();
    expect(store.getState().scene).toEqual(v2);
  });
});
