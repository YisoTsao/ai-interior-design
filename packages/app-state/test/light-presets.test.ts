import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { activeLevel, addObject, addRectRoom, createEditorStore, lightingPreset } from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], [5000, 4000]));
  s.exec(addObject(s.levelId, { catalogId: 'lamp_downlight_a', position: [2500, 2740, 2000], rotationY: 0 }));
  s.exec(addObject(s.levelId, { catalogId: 'lamp_floor_a', position: [800, 0, 800], rotationY: 0 }));
  s.exec(addObject(s.levelId, { catalogId: 'sofa_3seat_a', position: [2500, 0, 3400], rotationY: 0 }));
  return store;
};
const lights = (store: ReturnType<typeof setup>) =>
  activeLevel(store.getState()).objects.filter((o) => catalog.get(o.catalogId)?.light);

describe('lightingPreset', () => {
  it('溫馨：全部 2700K、亮度 60%；一次 undo 還原', () => {
    const store = setup();
    const s = store.getState();
    s.exec(lightingPreset(s.levelId, activeLevel(s), catalog, 'cozy')!);
    for (const o of lights(store)) {
      expect(o.light?.kelvin).toBe(2700);
      expect(o.light?.lumens).toBe(Math.round(catalog.get(o.catalogId)!.light!.lumens * 0.6));
    }
    store.getState().undo();
    expect(lights(store).every((o) => !o.light)).toBe(true);
  });
  it('劇院：天花燈關、立燈保留；重設保留方向', () => {
    const store = setup();
    const s = store.getState();
    s.exec(lightingPreset(s.levelId, activeLevel(s), catalog, 'cinema')!);
    const [down, floor] = lights(store);
    expect(down!.light?.on).toBe(false);
    expect(floor!.light?.on).toBe(true);
    const st = store.getState();
    st.exec(lightingPreset(st.levelId, activeLevel(st), catalog, 'reset')!);
    expect(lights(store).every((o) => o.light && Object.keys(o.light).length === 0)).toBe(true);
  });
  it('沒有燈具時回傳 null', () => {
    const store = createEditorStore();
    const s = store.getState();
    expect(lightingPreset(s.levelId, activeLevel(s), catalog, 'party')).toBeNull();
  });
});
