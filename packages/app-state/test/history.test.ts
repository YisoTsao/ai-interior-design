import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addObject,
  addOpening,
  addRectRoom,
  addWalls,
  canRedo,
  canUndo,
  createEditorStore,
  deleteEntities,
  displayLevel,
  duplicateObjects,
  moveWallVertex,
  renameRoom,
  resizeWall,
  saveCameraBookmark,
  setMaterial,
  transformObject,
  translateWall,
  updateObject,
  updateOpening,
  updateWall,
  type Command,
} from '../src/index.js';

const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const lvl = store.getState().levelId;
  store.getState().exec(addRectRoom(lvl, [0, 0], [4000, 3000]));
  return { store, lvl, L: () => activeLevel(store.getState()) };
};
const wallAt = (
  L: ReturnType<ReturnType<typeof setup>['L']>,
  pred: (w: { a: number[]; b: number[] }) => boolean,
) => L.walls.find(pred)!;

describe('Command / Undo / Redo（S2.1）', () => {
  it('addRectRoom：4 面牆 + 1 個房間（預設地板材質）', () => {
    const { store, L } = setup();
    expect(L().walls).toHaveLength(4);
    expect(L().rooms).toHaveLength(1);
    expect(L().rooms[0]!.floorMaterialId).toBe('mat_wood_oak');
    expect(canUndo(store.getState())).toBe(true);
    expect(validateScene(store.getState().scene).ok).toBe(true);
  });

  it('undo/redo 往返完全一致', () => {
    const { store } = setup();
    const after = store.getState().scene;
    store.getState().undo();
    expect(activeLevel(store.getState()).walls).toHaveLength(0);
    expect(canRedo(store.getState())).toBe(true);
    store.getState().redo();
    expect(store.getState().scene).toEqual(after);
    store.getState().redo(); // 無可 redo：不變
    expect(store.getState().scene).toEqual(after);
  });

  it('被拒絕的 Command 不進歷史並產生提示', () => {
    const { store, lvl, L } = setup();
    const before = store.getState().history.past.length;
    const s = wallAt(L(), (w) => w.a[1] === 0 && w.b[1] === 0);
    expect(
      store
        .getState()
        .exec(addOpening(lvl, { wallId: s.id, type: 'door', offset: 3500, width: 900, height: 2100 })),
    ).toBe(false);
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().notices.at(-1)?.message).toMatch(/超出/);
    store.getState().dismiss(store.getState().notices.at(-1)!.id);
  });

  it('無變更的 Command 不記錄', () => {
    const { store } = setup();
    const noop: Command = { id: 'n', label: 'noop', do: () => {} };
    expect(store.getState().exec(noop)).toBe(false);
  });

  it('非 CommandRejected 的例外會往外拋', () => {
    const { store } = setup();
    expect(() =>
      store.getState().exec({
        id: 'x',
        label: 'x',
        do: () => {
          throw new TypeError('boom');
        },
      }),
    ).toThrow('boom');
  });

  it('拖曳預覽不進歷史；exec 會清除預覽', () => {
    const { store, lvl, L } = setup();
    const preview = { ...L(), walls: [] };
    store.getState().setPreview(preview);
    expect(displayLevel(store.getState()).walls).toHaveLength(0);
    const s = wallAt(L(), (w) => w.a[1] === 0 && w.b[1] === 0);
    store.getState().exec(moveWallVertex(lvl, { wallId: s.id, end: 'b' }, [4500, 0]));
    expect(store.getState().preview).toBeNull();
  });

  it('property：任意合法指令序列，全部 undo 後回到初始場景', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 12 }), (ops) => {
        const { store, lvl, L } = setup();
        const initial = store.getState().scene;
        let n = 0;
        for (const op of ops) {
          const w = L().walls[op % Math.max(1, L().walls.length)];
          const cmds: (Command | null)[] = [
            addObject(lvl, { catalogId: 'sofa_3seat_a', position: [1000 + op * 100, 0, 1000], rotationY: 0 }),
            w ? resizeWall(lvl, w.id, 3000 + op * 250) : null,
            w ? updateWall(lvl, w.id, { thickness: 120 }) : null,
            w
              ? addOpening(lvl, {
                  wallId: w.id,
                  type: 'window',
                  offset: 100,
                  width: 600,
                  height: 1000,
                  sill: 900,
                })
              : null,
            L().objects[0] ? transformObject(lvl, L().objects[0]!.id, { rotationY: op }) : null,
            w ? translateWall(lvl, w.id, [0, 100]) : null,
          ];
          const c = cmds[op];
          if (c && store.getState().exec(c)) n++;
          expect(validateScene(store.getState().scene).ok).toBe(true);
        }
        for (let i = 0; i < n; i++) store.getState().undo();
        expect(store.getState().scene).toEqual(initial);
      }),
      { numRuns: 60 },
    );
  });
});

describe('commands', () => {
  it('addWalls：連續畫牆、共線自動合併、太短拒絕', () => {
    const store = createEditorStore();
    const lvl = store.getState().levelId;
    store.getState().exec(
      addWalls(lvl, [
        [0, 0],
        [1000, 0],
        [2000, 0],
        [2000, 1000],
      ]),
    );
    expect(activeLevel(store.getState()).walls).toHaveLength(2);
    expect(
      store.getState().exec(
        addWalls(lvl, [
          [0, 0],
          [50, 0],
        ]),
      ),
    ).toBe(false);
    expect(
      store.getState().exec(
        addWalls(lvl, [
          [5000, 5000],
          [5000, 5000],
        ]),
      ),
    ).toBe(false); // 全部重複點：無變更
    expect(
      store.getState().exec(
        addWalls('missing', [
          [0, 0],
          [1000, 0],
        ]),
      ),
    ).toBe(false);
  });

  it('moveWallVertex 保留房間材質與名稱；阻止開口超出', () => {
    const { store, lvl, L } = setup();
    const room = L().rooms[0]!;
    store.getState().exec(setMaterial(lvl, { kind: 'floor', roomId: room.id }, 'mat_tile_grey60'));
    store.getState().exec(renameRoom(lvl, room.id, '客廳'));
    const s = wallAt(L(), (w) => w.a[1] === 0 && w.b[1] === 0);
    store.getState().exec(moveWallVertex(lvl, { wallId: s.id, end: s.b[0] === 4000 ? 'b' : 'a' }, [5000, 0]));
    expect(L().rooms[0]).toMatchObject({ id: room.id, label: '客廳', floorMaterialId: 'mat_tile_grey60' });
    store
      .getState()
      .exec(addOpening(lvl, { wallId: s.id, type: 'door', offset: 3500, width: 900, height: 2100 }));
    expect(store.getState().exec(resizeWall(lvl, s.id, 3000))).toBe(false);
  });

  it('T 型隔間切出兩房：兩房都繼承原房屬性之一', () => {
    const { store, lvl, L } = setup();
    store.getState().exec(renameRoom(lvl, L().rooms[0]!.id, '大房'));
    store.getState().exec(
      addWalls(lvl, [
        [2000, 0],
        [2000, 3000],
      ]),
    );
    expect(L().rooms).toHaveLength(2);
    expect(L().rooms.filter((r) => r.label === '大房')).toHaveLength(1);
  });

  it('門窗：新增、更新、重疊與超高拒絕', () => {
    const { store, lvl, L } = setup();
    const s = wallAt(L(), (w) => w.a[1] === 0 && w.b[1] === 0);
    store
      .getState()
      .exec(addOpening(lvl, { wallId: s.id, type: 'door', offset: 500, width: 900, height: 2100 }));
    const o = L().openings[0]!;
    store.getState().exec(updateOpening(lvl, o.id, { offset: 1000.4 }));
    expect(L().openings[0]!.offset).toBe(1000);
    expect(
      store
        .getState()
        .exec(addOpening(lvl, { wallId: s.id, type: 'window', offset: 1500, width: 900, height: 900 })),
    ).toBe(false);
    expect(store.getState().exec(updateOpening(lvl, o.id, { height: 3000 }))).toBe(false);
    expect(store.getState().exec(updateOpening(lvl, 'nope', { height: 1000 }))).toBe(false);
    expect(
      store
        .getState()
        .exec(addOpening(lvl, { wallId: 'nope', type: 'door', offset: 0, width: 900, height: 2000 })),
    ).toBe(false);
  });

  it('刪除牆連帶刪除其門窗並重算房間；刪除物件', () => {
    const { store, lvl, L } = setup();
    const s = wallAt(L(), (w) => w.a[1] === 0 && w.b[1] === 0);
    store
      .getState()
      .exec(addOpening(lvl, { wallId: s.id, type: 'door', offset: 500, width: 900, height: 2100 }));
    store
      .getState()
      .exec(addObject(lvl, { catalogId: 'sofa_3seat_a', position: [1000, 0, 1000], rotationY: 0 }));
    store.getState().select([s.id, L().objects[0]!.id]);
    store.getState().exec(deleteEntities(lvl, [s.id, L().objects[0]!.id]));
    expect(L().openings).toHaveLength(0);
    expect(L().rooms).toHaveLength(0);
    expect(L().objects).toHaveLength(0);
    expect(store.getState().selection).toEqual([]);
  });

  it('物件：變形、鎖定後拒絕、縮放需 >0、複製、材質覆寫', () => {
    const { store, lvl, L } = setup();
    store
      .getState()
      .exec(addObject(lvl, { catalogId: 'sofa_3seat_a', position: [1000.6, 0, 1000], rotationY: 0 }));
    const id = L().objects[0]!.id;
    expect(L().objects[0]!.position).toEqual([1001, 0, 1000]);
    store
      .getState()
      .exec(transformObject(lvl, id, { position: [2000, 0, 1500], rotationY: 1.57, scale: [1.2, 1.2, 1.2] }));
    expect(L().objects[0]).toMatchObject({
      position: [2000, 0, 1500],
      rotationY: 1.57,
      scale: [1.2, 1.2, 1.2],
    });
    expect(store.getState().exec(transformObject(lvl, id, { scale: [0, 1, 1] }))).toBe(false);
    const dup = duplicateObjects(lvl, [id]);
    store.getState().exec(dup);
    expect(L().objects).toHaveLength(2);
    expect(L().objects[1]!.position).toEqual([2200, 0, 1700]);
    expect(dup.newIds).toHaveLength(1);
    store.getState().exec(setMaterial(lvl, { kind: 'object', id, slot: 'body' }, 'mat_fabric_charcoal'));
    expect(L().objects[0]!.materialOverrides).toEqual({ body: 'mat_fabric_charcoal' });
    store.getState().exec(updateObject(lvl, id, { locked: true }));
    expect(store.getState().exec(transformObject(lvl, id, { rotationY: 0 }))).toBe(false);
    expect(store.getState().exec(transformObject(lvl, 'nope', { rotationY: 0 }))).toBe(false);
    expect(store.getState().exec(updateObject(lvl, 'nope', { locked: true }))).toBe(false);
  });

  it('牆屬性與材質、錯誤目標', () => {
    const { store, lvl, L } = setup();
    const w = L().walls[0]!;
    store.getState().exec(updateWall(lvl, w.id, { thickness: 200, type: 'exterior' }));
    expect(L().walls[0]).toMatchObject({ thickness: 200, type: 'exterior' });
    expect(store.getState().exec(updateWall(lvl, w.id, { thickness: 5 }))).toBe(false);
    expect(store.getState().exec(updateWall(lvl, 'nope', { type: 'exterior' }))).toBe(false);
    store.getState().exec(setMaterial(lvl, { kind: 'wall', id: w.id, side: 'A' }, 'mat_paint_sage'));
    expect(L().walls[0]).toMatchObject({ materialId: 'mat_paint_sage', materialIdB: 'mat_paint_white' });
    store.getState().exec(setMaterial(lvl, { kind: 'wall', id: w.id, side: 'B' }, 'mat_tile_white'));
    expect(L().walls[0]!.materialIdB).toBe('mat_tile_white');
    store
      .getState()
      .exec(setMaterial(lvl, { kind: 'ceiling', roomId: L().rooms[0]!.id }, 'mat_ceiling_white'));
    expect(L().rooms[0]!.ceilingMaterialId).toBe('mat_ceiling_white');
    for (const t of [
      { kind: 'wall', id: 'x', side: 'both' },
      { kind: 'object', id: 'x', slot: 'b' },
      { kind: 'floor', roomId: 'x' },
    ] as const)
      expect(store.getState().exec(setMaterial(lvl, t, 'm'))).toBe(false);
    expect(store.getState().exec(renameRoom(lvl, 'x', 'y'))).toBe(false);
    expect(store.getState().exec(translateWall(lvl, 'x', [1, 1]))).toBe(false);
  });

  it('相機書籤存進 scene.cameras', () => {
    const { store } = setup();
    store.getState().exec(
      saveCameraBookmark({
        name: '客廳',
        position: [1, 1600, 2.4],
        target: [3000, 1000, 3000],
        fovDeg: 60,
      }),
    );
    expect(store.getState().scene.cameras?.[0]).toMatchObject({ name: '客廳', position: [1, 1600, 2] });
  });
});

describe('UI 暫態', () => {
  it('選取（含 Shift 多選切換）、工具、視圖、圖層、吸附、改名', () => {
    const { store } = setup();
    const st = () => store.getState();
    st().select(['a', 'b']);
    st().select(['b', 'c'], true);
    expect(st().selection.sort()).toEqual(['a', 'c']);
    st().setTool('place', 'sofa_3seat_a');
    expect(st().placeCatalogId).toBe('sofa_3seat_a');
    st().setTool('wall');
    expect(st().placeCatalogId).toBeNull();
    st().setView('3d');
    st().toggleLayer('furniture');
    st().setSnap(false);
    st().rename('新名稱');
    expect(st()).toMatchObject({
      view: '3d',
      snapEnabled: false,
      projectName: '新名稱',
      saveStatus: 'dirty',
    });
    expect(st().layers.furniture).toBe(false);
    for (let i = 0; i < 8; i++) st().notify('info', `n${i}`);
    expect(st().notices.length).toBeLessThanOrEqual(5);
  });
});
