import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { validateScene } from '@interiorai/scene-schema';
import {
  activeLevel,
  addAnnotation,
  addLevel,
  addObject,
  addOpening,
  addRectRoom,
  alignObjects,
  arrayCopy,
  batch,
  createEditorStore,
  deleteEntities,
  deleteLevel,
  distributeObjects,
  duplicateLevel,
  groupObjects,
  makeClip,
  mirrorObjects,
  pasteClip,
  quoteOf,
  saveCameraBookmark,
  setQuote,
  ungroupObjects,
  updateCamera,
  updateLevel,
  updateObject,
  deleteCamera,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const setup = () => {
  const store = createEditorStore({ projectName: 't' });
  const lvl = store.getState().levelId;
  const exec = store.getState().exec;
  exec(addRectRoom(lvl, [0, 0], [6000, 4000]));
  for (const x of [1000, 2500, 4800])
    exec(addObject(lvl, { catalogId: 'table_side_a', position: [x, 0, 1000 + x / 10], rotationY: 0 }));
  return { store, lvl, exec, L: () => activeLevel(store.getState()) };
};

describe('編輯操作（前台需求 PLAN／LVL／V3D／DOC）', () => {
  it('批次：多個修改一次 undo', () => {
    const { store, lvl, exec, L } = setup();
    const ids = L().objects.map((o) => o.id);
    exec(batch(ids.map((id) => updateObject(lvl, id, { appearance: { color: '#ff0000' } }))));
    expect(L().objects.every((o) => o.appearance?.color === '#ff0000')).toBe(true);
    store.getState().undo();
    expect(L().objects.every((o) => !o.appearance)).toBe(true);
  });

  it('對齊（左、中）與等距分佈', () => {
    const { lvl, exec, L } = setup();
    const ids = L().objects.map((o) => o.id);
    exec(alignObjects(lvl, ids, 'top', catalog));
    const zs = L().objects.map((o) => o.position[2]);
    expect(new Set(zs).size).toBe(1);
    exec(alignObjects(lvl, ids, 'centerX', catalog));
    expect(new Set(L().objects.map((o) => o.position[0])).size).toBe(1);
    exec(alignObjects(lvl, ids, 'left', catalog));
    // 回到不同 x 再分佈
    exec(
      batch(
        ids.map((id, i) => ({
          id: `m${i}`,
          label: 'x',
          do: (d) => {
            const o = d.levels[0]!.objects.find((x) => x.id === id)!;
            o.position = [[1000, 1700, 5000][i]!, 0, 1000];
          },
        })),
      ),
    );
    exec(distributeObjects(lvl, ids, 'x', catalog));
    const xs = L()
      .objects.map((o) => o.position[0])
      .sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBe(xs[2]! - xs[1]!);
  });

  it('複製／貼上：牆帶門窗、物件以游標為中心、房間同步', () => {
    const { store, lvl, exec, L } = setup();
    const w = L().walls[0]!;
    exec(addOpening(lvl, { wallId: w.id, type: 'door', offset: 500, width: 900, height: 2100 }));
    const clip = makeClip(L(), [...L().walls.map((x) => x.id), L().objects[0]!.id])!;
    expect(clip.openings).toHaveLength(1);
    const cmd = pasteClip(lvl, clip, [clip.center[0] + 10000, clip.center[1]]);
    exec(cmd);
    expect(L().walls).toHaveLength(8);
    expect(L().openings).toHaveLength(2);
    expect(L().rooms).toHaveLength(2);
    expect(cmd.newIds).toHaveLength(5);
    expect(validateScene(store.getState().scene).ok).toBe(true);
  });

  it('群組／解散、鏡像、陣列複製', () => {
    const { lvl, exec, L } = setup();
    const ids = L().objects.map((o) => o.id);
    const g = groupObjects(lvl, ids.slice(0, 2));
    exec(g);
    expect(L().objects.filter((o) => o.groupId === g.groupId)).toHaveLength(2);
    exec(ungroupObjects(lvl, [ids[0]!]));
    expect(L().objects.some((o) => o.groupId)).toBe(false);
    const before = L().objects.map((o) => o.position[0]);
    exec(mirrorObjects(lvl, ids, 'x'));
    const c = before.reduce((a, x) => a + x, 0) / before.length;
    expect(L().objects.map((o) => o.position[0])).toEqual(before.map((x) => Math.round(2 * c - x)));
    expect(L().objects[0]!.mirrored).toBe(true);
    exec(mirrorObjects(lvl, ids, 'x'));
    L().objects.forEach((o, i) => expect(Math.abs(o.position[0] - before[i]!)).toBeLessThanOrEqual(1));
    expect(L().objects[0]!.mirrored).toBeUndefined();
    const arr = arrayCopy(lvl, [ids[0]!], 3, [500, 0]);
    exec(arr);
    expect(arr.newIds).toHaveLength(3);
    expect(L().objects).toHaveLength(6);
    expect(L().objects.at(-1)!.position[0]).toBe(L().objects[0]!.position[0] + 1500);
  });

  it('標註：新增、刪除（deleteEntities 也刪標註）', () => {
    const { store, lvl, exec, L } = setup();
    exec(
      addAnnotation(lvl, {
        id: 'ann_t1',
        type: 'text',
        data: { position: [100, 100], text: '備註', size: 200 },
      }),
    );
    exec(addAnnotation(lvl, { type: 'dimension', data: { a: [0, 0], b: [6000, 0], offset: -500 } }));
    expect(L().annotations).toHaveLength(2);
    store.getState().select(['ann_t1']);
    expect(store.getState().selection).toEqual(['ann_t1']);
    exec(deleteEntities(lvl, ['ann_t1']));
    expect(L().annotations).toHaveLength(1);
    expect(validateScene(store.getState().scene).ok).toBe(true);
  });

  it('樓層：新增（堆疊標高、複製外牆）、改樓高連動上層、複製、刪除（至少留一層）', () => {
    const { store, lvl, exec } = setup();
    const s = () => store.getState().scene;
    exec(addLevel({ name: '2F', copyWallsFrom: lvl }));
    expect(s().levels).toHaveLength(2);
    expect(s().levels[1]!.elevation).toBe(2800 + 150);
    exec(updateLevel(lvl, { height: 3000 }));
    expect(s().levels[1]!.elevation).toBe(3000 + 150);
    const dup = duplicateLevel(lvl);
    exec(dup);
    expect(s().levels).toHaveLength(3);
    expect(s().levels[2]!.objects).toHaveLength(3);
    expect(s().levels[2]!.rooms).toHaveLength(1);
    store.getState().setLevel(dup.levelId);
    expect(store.getState().levelId).toBe(dup.levelId);
    exec(deleteLevel(dup.levelId));
    expect(store.getState().levelId).toBe(s().levels[0]!.id);
    exec(deleteLevel(s().levels[1]!.id));
    expect(exec(deleteLevel(lvl))).toBe(false);
    expect(validateScene(s()).ok).toBe(true);
  });

  it('相機書籤改名／刪除；報價設定存在 meta.quote', () => {
    const { store, exec } = setup();
    exec(saveCameraBookmark({ name: 'A', position: [0, 1600, 0], target: [1000, 1400, 0], fovDeg: 50 }));
    const cam = store.getState().scene.cameras![0]!;
    exec(updateCamera(cam.id, { name: '客廳全景' }));
    expect(store.getState().scene.cameras![0]!.name).toBe('客廳全景');
    exec(deleteCamera(cam.id));
    expect(store.getState().scene.cameras).toHaveLength(0);
    exec(setQuote({ taxRate: 0.05, prices: { sofa_3seat_a: 25000 } }));
    exec(setQuote({ discount: 1000 }));
    expect(quoteOf(store.getState().scene)).toEqual({
      taxRate: 0.05,
      prices: { sofa_3seat_a: 25000 },
      discount: 1000,
    });
    expect(validateScene(store.getState().scene).ok).toBe(true);
  });

  it('jump：一次往回多步', () => {
    const { store, L } = setup();
    expect(L().objects).toHaveLength(3);
    store.getState().jump(-2);
    expect(L().objects).toHaveLength(1);
    store.getState().jump(1);
    expect(L().objects).toHaveLength(2);
  });
});
