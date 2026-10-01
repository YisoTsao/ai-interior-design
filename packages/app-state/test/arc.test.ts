import { describe, expect, it } from 'vitest';
import { arcPoints } from '@interiorai/core-geometry';
import {
  activeLevel,
  addOpening,
  addWalls,
  arcChain,
  arcMidpoint,
  createEditorStore,
  reshapeArc,
} from '../src/index.js';

const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addWalls(s.levelId, arcPoints([0, 0], [4000, 0], [2000, 1000]), { arcGroup: 'arc_1' }));
  return store;
};

describe('弧形牆凸度（PLAN-02）', () => {
  it('arcGroup 標在每一段；鏈依序、端點正確', () => {
    const lv = activeLevel(setup().getState());
    expect(lv.walls.every((w) => w.arcGroup === 'arc_1')).toBe(true);
    const c = arcChain(lv, 'arc_1')!;
    expect(c.segs.length).toBe(lv.walls.length);
    expect([c.A, c.B].map(String).sort()).toEqual(['0,0', '4000,0']);
    const m = arcMidpoint(lv, 'arc_1')!;
    expect(Math.abs(m[0] - 2000)).toBeLessThan(50);
    expect(Math.abs(Math.abs(m[1]) - 1000)).toBeLessThan(50);
  });

  it('改凸度：端點不變、新的弧通過指定點、門窗跟著比例位置、一步 undo', () => {
    const store = setup();
    const s = store.getState();
    const lv0 = activeLevel(s);
    const c0 = arcChain(lv0, 'arc_1')!;
    const mid = c0.segs[Math.floor(c0.segs.length / 2)]!.w;
    s.exec(
      addOpening(s.levelId, {
        wallId: mid.id,
        type: 'window',
        offset: 20,
        width: 300,
        height: 1200,
        sill: 900,
      }),
    );
    const before = activeLevel(store.getState());
    s.exec(reshapeArc(s.levelId, 'arc_1', [2000, 2000]));
    const lv = activeLevel(store.getState());
    const c = arcChain(lv, 'arc_1')!;
    expect([c.A, c.B].map(String).sort()).toEqual(['0,0', '4000,0']);
    const m = arcMidpoint(lv, 'arc_1')!;
    expect(Math.abs(m[1] - 2000)).toBeLessThan(80);
    expect(lv.openings).toHaveLength(1);
    expect(lv.walls.some((w) => w.id === lv.openings[0]!.wallId)).toBe(true);
    store.getState().undo();
    expect(activeLevel(store.getState())).toEqual(before);
  });

  it('三點共線被拒絕', () => {
    const store = setup();
    const s = store.getState();
    expect(s.exec(reshapeArc(s.levelId, 'arc_1', [2000, 0]))).toBe(false);
  });
});
