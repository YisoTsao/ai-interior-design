import {
  activeLevel,
  alignObjects,
  arrayCopy,
  batch,
  deleteEntities,
  distributeObjects,
  duplicateObjects,
  groupObjects,
  makeClip,
  mirrorObjects,
  pasteClip,
  transformObject,
  ungroupObjects,
  updateObject,
  type AlignMode,
  type EditorStore,
} from '@interiorai/app-state';
import type { Vec2 } from '@interiorai/core-geometry';
import { plan2dApi } from '@interiorai/editor-2d';
import { catalog } from '../catalogData';
import { getClip, setClip } from './clipboard';
import { mergeLook } from './look';

/**
 * 編輯動作（快捷鍵、右鍵選單、屬性面板共用）。每個動作都是單一 Command（一次 undo）。
 */
export function editActions(store: EditorStore) {
  const st = () => store.getState();
  const level = () => activeLevel(st());
  const objIds = () => st().selection.filter((id) => level().objects.some((o) => o.id === id));
  const exec = (c: Parameters<ReturnType<EditorStore['getState']>['exec']>[0]) => st().exec(c);

  const copy = () => {
    const c = makeClip(level(), st().selection);
    if (c) setClip(c);
    return !!c;
  };
  const del = () => {
    if (st().selection.length) exec(deleteEntities(st().levelId, st().selection));
  };
  return {
    copy,
    cut() {
      if (copy()) del();
    },
    /** 貼上：at 未指定時用 2D 游標位置，再退回原位置偏移 500 mm */
    paste(at?: Vec2) {
      const c = getClip();
      if (!c) return;
      const p = at ?? plan2dApi.get()?.pointerWorld() ?? ([c.center[0] + 500, c.center[1] + 500] as Vec2);
      const cmd = pasteClip(st().levelId, c, p);
      if (exec(cmd)) st().select(cmd.newIds);
    },
    duplicate() {
      const ids = objIds();
      if (!ids.length) return;
      const c = duplicateObjects(st().levelId, ids);
      if (exec(c)) st().select(c.newIds);
    },
    del,
    selectAll() {
      const l = level();
      st().select([...l.walls, ...l.objects, ...(l.annotations ?? [])].map((x) => x.id));
    },
    /** 選取同類型（同目錄項，或同為牆／門窗） */
    selectSame() {
      const l = level();
      const id = st().selection[0];
      const o = l.objects.find((x) => x.id === id);
      if (o) return st().select(l.objects.filter((x) => x.catalogId === o.catalogId).map((x) => x.id));
      if (l.walls.some((w) => w.id === id)) return st().select(l.walls.map((w) => w.id));
      const op = l.openings.find((x) => x.id === id);
      if (op) st().select(l.openings.filter((x) => x.type === op.type).map((x) => x.id));
    },
    rotate(deg: number) {
      const l = level();
      const ids = objIds();
      exec(
        batch(
          ids
            .map((id) => l.objects.find((o) => o.id === id)!)
            .filter((o) => !o.locked)
            .map((o) => transformObject(l.id, o.id, { rotationY: o.rotationY + (deg * Math.PI) / 180 })),
          'command.transformObject',
        ),
      );
    },
    mirror(axis: 'x' | 'z') {
      exec(mirrorObjects(st().levelId, objIds(), axis));
    },
    group() {
      exec(groupObjects(st().levelId, objIds()));
    },
    ungroup() {
      exec(ungroupObjects(st().levelId, objIds()));
    },
    align(mode: AlignMode) {
      exec(alignObjects(st().levelId, objIds(), mode, catalog));
    },
    distribute(axis: 'x' | 'z') {
      exec(distributeObjects(st().levelId, objIds(), axis, catalog));
    },
    array(count: number, step: Vec2) {
      const c = arrayCopy(st().levelId, objIds(), count, step);
      if (exec(c)) st().select([...objIds(), ...c.newIds]);
    },
    toggleLock() {
      const l = level();
      const objs = objIds().map((id) => l.objects.find((o) => o.id === id)!);
      const lock = objs.some((o) => !o.locked);
      exec(
        batch(
          objs.map((o) => updateObject(l.id, o.id, { locked: lock || undefined })),
          'command.updateObject',
        ),
      );
    },
    toggleHide() {
      const l = level();
      const objs = objIds().map((id) => l.objects.find((o) => o.id === id)!);
      const hide = objs.some((o) => !o.appearance?.hidden);
      exec(
        batch(
          objs.map((o) =>
            updateObject(l.id, o.id, { appearance: mergeLook(o.appearance, { hidden: hide || undefined }) }),
          ),
          'command.updateObject',
        ),
      );
    },
    counts() {
      const l = level();
      const sel = st().selection;
      return {
        objects: objIds().length,
        walls: sel.filter((id) => l.walls.some((w) => w.id === id)).length,
        any: sel.length,
        grouped: objIds().some((id) => l.objects.find((o) => o.id === id)?.groupId),
        clip: !!getClip(),
      };
    },
  };
}
export type EditActions = ReturnType<typeof editActions>;
