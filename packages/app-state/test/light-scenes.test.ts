import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addObject,
  applyLightScene,
  createEditorStore,
  deleteLightScene,
  lightGroups,
  lightStateOf,
  saveLightScene,
  setGroupLights,
  setLightGroup,
  withLightState,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addObject(s.levelId, { catalogId: 'lamp_floor_a', position: [0, 0, 0], rotationY: 0 }));
  s.exec(addObject(s.levelId, { catalogId: 'lamp_pendant_a', position: [1000, 2000, 0], rotationY: 0 }));
  s.exec(addObject(s.levelId, { catalogId: 'lamp_table_a', position: [2000, 700, 0], rotationY: 0 }));
  return store;
};

describe('燈光群組與情境（FE-LGT-05）', () => {
  it('狀態換算：比例寫成光通量覆寫；未覆寫＝1', () => {
    const o = activeLevel(setup().getState()).objects[0]!;
    expect(lightStateOf(o, catalog)).toEqual({ on: true, level: 1 });
    const dim = withLightState(o, catalog, { on: true, level: 0.5 });
    expect(dim.light?.lumens).toBe(450);
    expect(lightStateOf(dim, catalog)).toEqual({ on: true, level: 0.5 });
  });

  it('群組：設定、列出、一起關燈（單一 undo）', () => {
    const store = setup();
    const s = store.getState();
    const [a, b, c] = activeLevel(s).objects.map((o) => o.id) as [string, string, string];
    s.exec(setLightGroup(s.levelId, [a, b], '客廳'));
    expect(lightGroups(activeLevel(store.getState()))).toEqual(['客廳']);
    s.exec(setGroupLights(s.levelId, activeLevel(store.getState()), catalog, '客廳', { on: false }));
    const lv = activeLevel(store.getState());
    expect(lv.objects.map((o) => o.light?.on)).toEqual([false, false, undefined]);
    expect(lv.objects.find((o) => o.id === c)!.light?.group).toBeUndefined();
    store.getState().undo();
    expect(activeLevel(store.getState()).objects[0]!.light?.on).toBeUndefined();
  });

  it('情境：儲存目前狀態 → 改燈 → 套用回來；場景驗證通過；可刪除', () => {
    const store = setup();
    const s = store.getState();
    const cmd = saveLightScene('晚餐', activeLevel(s), catalog);
    s.exec(cmd);
    expect(store.getState().scene.lightScenes?.[0]?.name).toBe('晚餐');
    s.exec(
      setLightGroup(
        s.levelId,
        activeLevel(store.getState()).objects.map((o) => o.id),
        'all',
      ),
    );
    s.exec(
      setGroupLights(s.levelId, activeLevel(store.getState()), catalog, 'all', { on: false, level: 0.2 }),
    );
    const ls = store.getState().scene.lightScenes![0]!;
    s.exec(applyLightScene(s.levelId, ls, catalog));
    const lv = activeLevel(store.getState());
    expect(lv.objects.every((o) => o.light?.on === true)).toBe(true);
    expect(lv.objects[0]!.light?.lumens).toBe(900);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    s.exec(deleteLightScene(cmd.sceneId));
    expect(store.getState().scene.lightScenes).toBeUndefined();
  });
});
