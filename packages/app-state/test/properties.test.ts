import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addObject,
  addOpening,
  addRectRoom,
  createEditorStore,
  setEnvironment,
  updateObject,
  updateOpening,
  updateRoom,
  updateWall,
} from '../src/index.js';

const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const lvl = store.getState().levelId;
  store.getState().exec(addRectRoom(lvl, [0, 0], [4000, 3000]));
  store
    .getState()
    .exec(addObject(lvl, { catalogId: 'lamp_floor_a', position: [1000, 0, 1000], rotationY: 0 }));
  return { store, lvl, L: () => activeLevel(store.getState()) };
};

describe('外觀／光源／環境屬性（ADR-023）', () => {
  it('物件外觀與光源覆寫：可 undo，undefined 鍵恢復預設且不留在 Scene', () => {
    const { store, lvl, L } = setup();
    const id = L().objects[0]!.id;
    const exec = store.getState().exec;
    expect(exec(updateObject(lvl, id, { light: { lumens: 1500, kelvin: 2200, tiltDeg: -20 } }))).toBe(true);
    expect(
      exec(updateObject(lvl, id, { appearance: { color: '#336699', roughness: 0.3 }, name: '閱讀燈' })),
    ).toBe(true);
    expect(L().objects[0]!.light).toEqual({ lumens: 1500, kelvin: 2200, tiltDeg: -20 });
    expect(L().objects[0]!.name).toBe('閱讀燈');
    expect(validateScene(store.getState().scene).ok).toBe(true);
    exec(updateObject(lvl, id, { appearance: undefined }));
    expect('appearance' in L().objects[0]!).toBe(false);
    store.getState().undo();
    expect(L().objects[0]!.appearance).toEqual({ color: '#336699', roughness: 0.3 });
  });

  it('牆高：不可高於樓層、不可低於牆上的門窗', () => {
    const { store, lvl, L } = setup();
    const w = L().walls[0]!;
    const exec = store.getState().exec;
    expect(exec(updateWall(lvl, w.id, { height: 1200, baseboard: 80 }))).toBe(true);
    expect(L().walls[0]!.height).toBe(1200);
    expect(exec(updateWall(lvl, w.id, { height: 9000 }))).toBe(false);
    exec(updateWall(lvl, w.id, { height: undefined }));
    exec(addOpening(lvl, { wallId: w.id, type: 'door', offset: 500, width: 900, height: 2100 }));
    expect(exec(updateWall(lvl, w.id, { height: 1500 }))).toBe(false);
    expect(store.getState().notices.at(-1)?.code).toBe('WALL_HEIGHT_OUT_OF_RANGE');
  });

  it('門窗外觀、房間地板外觀、場景環境', () => {
    const { store, lvl, L } = setup();
    const exec = store.getState().exec;
    const w = L().walls[0]!;
    exec(
      addOpening(lvl, { wallId: w.id, type: 'window', offset: 500, width: 1200, height: 1200, sill: 900 }),
    );
    const o = L().openings[0]!;
    expect(exec(updateOpening(lvl, o.id, { appearance: { color: '#222222', opacity: 0.4 } }))).toBe(true);
    expect(exec(updateRoom(lvl, L().rooms[0]!.id, { floorAppearance: { roughness: 0.1 } }))).toBe(true);
    expect(exec(setEnvironment({ sky: 'moonlit', exposureEv: 1 }))).toBe(true);
    expect(store.getState().scene.environment).toEqual({ sky: 'moonlit', exposureEv: 1 });
    exec(setEnvironment({ sky: undefined, exposureEv: undefined }));
    expect(store.getState().scene.environment).toBeUndefined();
    expect(validateScene(store.getState().scene).ok).toBe(true);
  });
});
