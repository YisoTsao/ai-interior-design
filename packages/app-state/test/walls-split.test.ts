import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addOpening,
  addRectRoom,
  createEditorStore,
  mergeWalls,
  splitWall,
  setMaterial,
} from '../src/index.js';

const setup = () => {
  const store = createEditorStore();
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], [6000, 4000]));
  const south = activeLevel(store.getState()).walls.find((w) => w.a[1] === 0 && w.b[1] === 0)!;
  s.exec(
    addOpening(s.levelId, {
      wallId: south.id,
      type: 'window',
      offset: 4000,
      width: 1200,
      height: 1200,
      sill: 900,
    }),
  );
  return { store, south };
};

describe('splitWall / mergeWalls', () => {
  it('中點分割：兩段、窗戶移到第二段、房間仍是一間且合法', () => {
    const { store, south } = setup();
    const s = store.getState();
    expect(s.exec(splitWall(s.levelId, south.id))).toBe(true);
    const lv = activeLevel(store.getState());
    expect(lv.walls).toHaveLength(5);
    const win = lv.openings[0]!;
    expect(win.wallId).not.toBe(south.id);
    const w2 = lv.walls.find((w) => w.id === win.wallId)!;
    // 窗戶世界位置不變（x 起點 = 4000）
    const dir = Math.sign(w2.b[0] - w2.a[0]);
    expect(w2.a[0] + dir * win.offset).toBe(south.a[0] < south.b[0] ? 4000 : 6000 - 4000);
    expect(lv.rooms).toHaveLength(1);
    expect(lv.rooms[0]!.wallIds).toHaveLength(5);
    expect(validateScene(store.getState().scene).ok).toBe(true);
    // 各段可設不同材質
    expect(
      store.getState().exec(setMaterial(s.levelId, { kind: 'wall', id: w2.id, side: 'A' }, 'mat_paint_sage')),
    ).toBe(true);
    store.getState().undo();
    store.getState().undo();
    expect(activeLevel(store.getState()).walls).toHaveLength(4);
  });
  it('分割點落在窗上 → 拒絕', () => {
    const { store, south } = setup();
    const s = store.getState();
    const off = south.a[0] < south.b[0] ? 4500 : 1500;
    expect(s.exec(splitWall(s.levelId, south.id, off))).toBe(false);
  });
  it('合併：還原成一面牆、開口位置保留；非共線拒絕', () => {
    const { store, south } = setup();
    const s = store.getState();
    s.exec(splitWall(s.levelId, south.id, 2000));
    const lv = activeLevel(store.getState());
    const parts = lv.walls.filter((w) => w.a[1] === 0 && w.b[1] === 0);
    expect(parts).toHaveLength(2);
    expect(store.getState().exec(mergeWalls(s.levelId, parts[0]!.id, parts[1]!.id))).toBe(true);
    const after = activeLevel(store.getState());
    expect(after.walls).toHaveLength(4);
    const merged = after.walls.find((w) => w.a[1] === 0 && w.b[1] === 0)!;
    const win = after.openings[0]!;
    expect(win.wallId).toBe(merged.id);
    const x = merged.a[0] + Math.sign(merged.b[0] - merged.a[0]) * win.offset;
    expect([4000, 2000]).toContain(x);
    const east = after.walls.find((w) => w.a[0] === 6000 && w.b[0] === 6000)!;
    expect(store.getState().exec(mergeWalls(s.levelId, merged.id, east.id))).toBe(false);
  });
});
