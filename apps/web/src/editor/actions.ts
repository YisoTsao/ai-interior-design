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
  mergeWalls,
  mirrorObjects,
  pasteClip,
  setMaterial,
  splitWall,
  updateRoom,
  updateWall,
  transformObject,
  ungroupObjects,
  updateObject,
  type AlignMode,
  type EditorStore,
} from '@interiorai/app-state';
import { closestOnSegment, type Vec2 } from '@interiorai/core-geometry';
import type { Level } from '@interiorai/scene-schema';
import { plan2dApi } from '@interiorai/editor-2d';
import { catalog } from '../catalogData';
import { getClip, setClip } from './clipboard';
import { mergeLook } from './look';

/**
 * 編輯動作（快捷鍵、右鍵選單、屬性面板共用）。每個動作都是單一 Command（一次 undo）。
 */
/**
 * 樣式剪貼簿（FE-PROP-03）：複製物件的材質＋外觀、牆的兩面材質＋外觀＋鋪貼、房間的地板材質＋鋪貼，
 * 貼到同類型的選取項目（一次 undo）。
 */
type StyleClip =
  | {
      kind: 'object';
      materialOverrides?: Level['objects'][number]['materialOverrides'];
      appearance?: Level['objects'][number]['appearance'];
    }
  | {
      kind: 'wall';
      wall: Pick<
        Level['walls'][number],
        'materialId' | 'materialIdB' | 'appearance' | 'appearanceB' | 'tilingA' | 'tilingB'
      >;
    }
  | {
      kind: 'room';
      room: Pick<Level['rooms'][number], 'floorMaterialId' | 'floorAppearance' | 'floorTiling'>;
    };
let styleClip: StyleClip | null = null;

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
    /** 複製選取項目的樣式（取第一個） */
    copyStyle() {
      const l = level();
      const id = st().selection[0];
      const o = l.objects.find((x) => x.id === id);
      const w = l.walls.find((x) => x.id === id);
      const r = l.rooms.find((x) => x.id === id);
      if (o) {
        const { hidden: _h, ...look } = o.appearance ?? {};
        styleClip = {
          kind: 'object',
          materialOverrides: o.materialOverrides,
          appearance: Object.keys(look).length ? look : undefined,
        };
      } else if (w)
        styleClip = {
          kind: 'wall',
          wall: {
            materialId: w.materialId,
            materialIdB: w.materialIdB,
            appearance: w.appearance,
            appearanceB: w.appearanceB,
            tilingA: w.tilingA,
            tilingB: w.tilingB,
          },
        };
      else if (r)
        styleClip = {
          kind: 'room',
          room: {
            floorMaterialId: r.floorMaterialId,
            floorAppearance: r.floorAppearance,
            floorTiling: r.floorTiling,
          },
        };
      return !!(o || w || r);
    },
    pasteStyle() {
      const c = styleClip;
      if (!c) return;
      const l = level();
      const sel = st().selection;
      const cmds =
        c.kind === 'object'
          ? l.objects
              .filter((o) => sel.includes(o.id))
              .map((o) =>
                updateObject(l.id, o.id, {
                  // 只套用目標家具有的材質槽
                  materialOverrides: Object.fromEntries(
                    Object.entries(c.materialOverrides ?? {}).filter(([slot]) =>
                      catalog.get(o.catalogId)?.materialSlots.some((m) => m.name === slot),
                    ),
                  ),
                  appearance: mergeLook(c.appearance, { hidden: o.appearance?.hidden }),
                }),
              )
          : c.kind === 'wall'
            ? l.walls.filter((w) => sel.includes(w.id)).map((w) => updateWall(l.id, w.id, c.wall))
            : l.rooms
                .filter((r) => sel.includes(r.id))
                .flatMap((r) => [
                  ...(c.room.floorMaterialId
                    ? [setMaterial(l.id, { kind: 'floor', roomId: r.id }, c.room.floorMaterialId)]
                    : []),
                  updateRoom(l.id, r.id, {
                    floorAppearance: c.room.floorAppearance,
                    floorTiling: c.room.floorTiling,
                  }),
                ]);
      if (cmds.length) exec(batch(cmds, 'command.pasteStyle'));
    },
    hasStyle: () => !!styleClip,
    /** 在牆上（點擊位置或中點）插入節點（FE-PLAN-15） */
    splitWall(at?: Vec2) {
      const l = level();
      const w = l.walls.find((x) => st().selection.includes(x.id));
      if (!w) return;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const off = at ? closestOnSegment(at, w.a as Vec2, w.b as Vec2).t * L : undefined;
      exec(splitWall(l.id, w.id, off));
    },
    mergeWalls() {
      const l = level();
      const ws = l.walls.filter((x) => st().selection.includes(x.id));
      if (ws.length === 2) exec(mergeWalls(l.id, ws[0]!.id, ws[1]!.id));
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
