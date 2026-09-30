import type { Draft } from 'immer';
import { current, isDraft } from 'immer';
import { objectDims, type Catalog } from '@interiorai/catalog';
import { objectFootprint, type Vec2 } from '@interiorai/core-geometry';
import {
  newId,
  type Level,
  type Opening,
  type Room,
  type Scene,
  type SceneObject,
  type Wall,
} from '@interiorai/scene-schema';
import { CommandRejected, type Command } from './history.js';
import { syncRooms } from './commands.js';

/**
 * 編輯操作（前台需求規格 11：PLAN-06/07/08/10、LVL-01、V3D-09、PROP-02、DOC-01）。
 * 全部是單一 Command（一次 undo）；純資料操作，不依賴 UI。
 */
let seq = 0;
const cid = (kind: string) => `${kind}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const plain = <T>(v: T): T => (isDraft(v) ? (current(v as Draft<T>) as T) : v);
const levelOf = (d: Draft<Scene>, levelId: string): Draft<Level> => {
  const l = d.levels.find((x) => x.id === levelId);
  if (!l)
    throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: `找不到樓層 ${levelId}` }]);
  return l;
};

// ── 組合命令（批次編輯 PROP-02）───────────────────────────────────

/** 多個 Command 合成一步（任何一個被拒絕 → 全部不套用） */
export function batch(commands: readonly Command[], label = 'command.batch'): Command {
  return {
    id: cid('batch'),
    label,
    do: (d) => {
      for (const c of commands) c.do(d);
    },
  };
}

// ── 標註（PLAN-10）─────────────────────────────────────────────────

export interface DimensionData {
  a: Vec2;
  b: Vec2;
  /** 尺寸線相對於量測線的垂直偏移 mm（正＝左側） */
  offset: number;
}
export interface TextData {
  position: Vec2;
  text: string;
  /** 字高 mm */
  size: number;
  color?: string;
  rotation?: number;
}
export interface NoteData extends TextData {
  /** 引出線指向的點 */
  target: Vec2;
}
export type AnnotationInput =
  | { type: 'dimension'; data: DimensionData }
  | { type: 'text'; data: TextData }
  | { type: 'note'; data: NoteData };

export function addAnnotation(levelId: string, a: AnnotationInput & { id?: string }): Command {
  return {
    id: cid('annotation'),
    label: 'command.addAnnotation',
    do: (d) => {
      const lv = levelOf(d, levelId);
      lv.annotations = [
        ...(lv.annotations ?? []),
        { id: a.id ?? newId('ann'), type: a.type, data: { ...a.data } },
      ];
    },
  };
}

export function updateAnnotation(levelId: string, id: string, data: Record<string, unknown>): Command {
  return {
    id: cid('annotation'),
    label: 'command.updateAnnotation',
    do: (d) => {
      const a = levelOf(d, levelId).annotations?.find((x) => x.id === id);
      if (!a) throw new CommandRejected([{ code: 'TARGET_NOT_FOUND', id, message: '找不到標註' }]);
      a.data = { ...(a.data ?? {}), ...data };
    },
  };
}

// ── 對齊與分佈（PLAN-06）─────────────────────────────────────────

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerZ';

const bboxOf = (o: SceneObject, catalog: Catalog) => {
  const e = catalog.get(o.catalogId);
  if (!e) return { x0: o.position[0], x1: o.position[0], z0: o.position[2], z1: o.position[2] };
  const dm = objectDims(e, o.params, o.scale);
  const fp = objectFootprint(o.position, o.rotationY, dm.w, dm.d);
  const xs = fp.map((p) => p[0]);
  const zs = fp.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};

export function alignObjects(
  levelId: string,
  ids: readonly string[],
  mode: AlignMode,
  catalog: Catalog,
): Command {
  return {
    id: cid('align'),
    label: 'command.align',
    do: (d) => {
      const objs = levelOf(d, levelId).objects.filter((o) => ids.includes(o.id) && !o.locked);
      if (objs.length < 2) return;
      const boxes = objs.map((o) => bboxOf(plain(o) as SceneObject, catalog));
      const target =
        mode === 'left'
          ? Math.min(...boxes.map((b) => b.x0))
          : mode === 'right'
            ? Math.max(...boxes.map((b) => b.x1))
            : mode === 'top'
              ? Math.min(...boxes.map((b) => b.z0))
              : mode === 'bottom'
                ? Math.max(...boxes.map((b) => b.z1))
                : mode === 'centerX'
                  ? boxes.reduce((a, b) => a + (b.x0 + b.x1) / 2, 0) / boxes.length
                  : boxes.reduce((a, b) => a + (b.z0 + b.z1) / 2, 0) / boxes.length;
      objs.forEach((o, i) => {
        const b = boxes[i]!;
        const dx =
          mode === 'left'
            ? target - b.x0
            : mode === 'right'
              ? target - b.x1
              : mode === 'centerX'
                ? target - (b.x0 + b.x1) / 2
                : 0;
        const dz =
          mode === 'top'
            ? target - b.z0
            : mode === 'bottom'
              ? target - b.z1
              : mode === 'centerZ'
                ? target - (b.z0 + b.z1) / 2
                : 0;
        o.position = [Math.round(o.position[0] + dx), o.position[1], Math.round(o.position[2] + dz)];
      });
    },
  };
}

/** 等距分佈：依中心排序，首尾不動、中間等間距（依外框間隙） */
export function distributeObjects(
  levelId: string,
  ids: readonly string[],
  axis: 'x' | 'z',
  catalog: Catalog,
): Command {
  return {
    id: cid('distribute'),
    label: 'command.distribute',
    do: (d) => {
      const objs = levelOf(d, levelId).objects.filter((o) => ids.includes(o.id) && !o.locked);
      if (objs.length < 3) return;
      const items = objs
        .map((o) => ({ o, b: bboxOf(plain(o) as SceneObject, catalog) }))
        .map((x) => ({ ...x, lo: axis === 'x' ? x.b.x0 : x.b.z0, hi: axis === 'x' ? x.b.x1 : x.b.z1 }))
        .sort((a, b) => a.lo + a.hi - (b.lo + b.hi));
      const span = items[items.length - 1]!.hi - items[0]!.lo;
      const sizes = items.reduce((a, x) => a + (x.hi - x.lo), 0);
      const gap = (span - sizes) / (items.length - 1);
      let cursor = items[0]!.lo;
      for (const x of items) {
        const delta = Math.round(cursor - x.lo);
        if (axis === 'x') x.o.position = [x.o.position[0] + delta, x.o.position[1], x.o.position[2]];
        else x.o.position = [x.o.position[0], x.o.position[1], x.o.position[2] + delta];
        cursor += x.hi - x.lo + gap;
      }
    },
  };
}

// ── 剪貼簿（PLAN-08）─────────────────────────────────────────────

export interface Clip {
  walls: Wall[];
  openings: Opening[];
  objects: SceneObject[];
  /** 複製時選取內容的中心（貼上時對齊到游標） */
  center: Vec2;
}

/** 由選取建立剪貼內容（牆會帶著其上的門窗） */
export function makeClip(level: Level, ids: readonly string[]): Clip | null {
  const set = new Set(ids);
  const walls = level.walls.filter((w) => set.has(w.id));
  const wallIds = new Set(walls.map((w) => w.id));
  const openings = level.openings.filter((o) => wallIds.has(o.wallId));
  const objects = level.objects.filter((o) => set.has(o.id));
  const pts: Vec2[] = [
    ...walls.flatMap((w) => [w.a as Vec2, w.b as Vec2]),
    ...objects.map((o) => [o.position[0], o.position[2]] as Vec2),
  ];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return {
    walls: structuredClone(walls),
    openings: structuredClone(openings),
    objects: structuredClone(objects),
    center: [
      Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      Math.round((Math.min(...zs) + Math.max(...zs)) / 2),
    ],
  };
}

/** 貼上：以 at（世界座標）為新中心；回傳新 id（可用於選取） */
export function pasteClip(levelId: string, clip: Clip, at: Vec2): Command & { newIds: string[] } {
  const newIds: string[] = [];
  return {
    id: cid('paste'),
    label: 'command.paste',
    newIds,
    do: (d) => {
      newIds.length = 0;
      const lv = levelOf(d, levelId);
      const dx = Math.round(at[0] - clip.center[0]);
      const dz = Math.round(at[1] - clip.center[1]);
      const wallMap = new Map<string, string>();
      for (const w of clip.walls) {
        const id = newId('w');
        wallMap.set(w.id, id);
        newIds.push(id);
        lv.walls.push({
          ...structuredClone(w),
          id,
          a: [w.a[0] + dx, w.a[1] + dz],
          b: [w.b[0] + dx, w.b[1] + dz],
        });
      }
      for (const o of clip.openings) {
        const wallId = wallMap.get(o.wallId);
        if (!wallId) continue;
        lv.openings.push({ ...structuredClone(o), id: newId('o'), wallId });
      }
      const groupMap = new Map<string, string>();
      for (const o of clip.objects) {
        const id = newId('obj');
        newIds.push(id);
        const g = o.groupId
          ? (groupMap.get(o.groupId) ??
            groupMap.set(o.groupId, newId('obj').replace('obj_', 'grp_')).get(o.groupId))
          : undefined;
        lv.objects.push({
          ...structuredClone(o),
          id,
          position: [o.position[0] + dx, o.position[1], o.position[2] + dz],
          ...(g ? { groupId: g } : {}),
          locked: undefined,
        });
      }
      if (clip.walls.length) lv.rooms = syncRooms(plain(lv) as Level) as Draft<Room>[];
    },
  };
}

// ── 群組、鏡像、陣列（PLAN-07）───────────────────────────────────

export function groupObjects(levelId: string, ids: readonly string[]): Command & { groupId: string } {
  const groupId = newId('obj').replace('obj_', 'grp_');
  return {
    id: cid('group'),
    label: 'command.group',
    groupId,
    do: (d) => {
      const objs = levelOf(d, levelId).objects.filter((o) => ids.includes(o.id));
      if (objs.length < 2) return;
      for (const o of objs) o.groupId = groupId;
    },
  };
}

export function ungroupObjects(levelId: string, ids: readonly string[]): Command {
  return {
    id: cid('ungroup'),
    label: 'command.ungroup',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const groups = new Set(lv.objects.filter((o) => ids.includes(o.id) && o.groupId).map((o) => o.groupId));
      for (const o of lv.objects) if (o.groupId && groups.has(o.groupId)) delete o.groupId;
    },
  };
}

/** 左右（x）或前後（z）鏡像：以選取中心為軸，位置翻轉、朝向反射、物件本身標記 mirrored */
export function mirrorObjects(levelId: string, ids: readonly string[], axis: 'x' | 'z'): Command {
  return {
    id: cid('mirror'),
    label: 'command.mirror',
    do: (d) => {
      const objs = levelOf(d, levelId).objects.filter((o) => ids.includes(o.id) && !o.locked);
      if (!objs.length) return;
      const c =
        axis === 'x'
          ? objs.reduce((a, o) => a + o.position[0], 0) / objs.length
          : objs.reduce((a, o) => a + o.position[2], 0) / objs.length;
      for (const o of objs) {
        if (axis === 'x') {
          o.position = [Math.round(2 * c - o.position[0]), o.position[1], o.position[2]];
          o.rotationY = -o.rotationY;
        } else {
          o.position = [o.position[0], o.position[1], Math.round(2 * c - o.position[2])];
          o.rotationY = Math.PI - o.rotationY;
        }
        if (o.mirrored) delete o.mirrored;
        else o.mirrored = true;
      }
    },
  };
}

/** 陣列複製：沿 (dx, dz) 間距複製 count 份（不含原件） */
export function arrayCopy(
  levelId: string,
  ids: readonly string[],
  count: number,
  step: Vec2,
): Command & { newIds: string[] } {
  const newIds: string[] = [];
  return {
    id: cid('array'),
    label: 'command.arrayCopy',
    newIds,
    do: (d) => {
      newIds.length = 0;
      if (count < 1 || count > 200)
        throw new CommandRejected([{ code: 'ARRAY_INVALID', id: 'array', message: '數量需介於 1–200' }]);
      const lv = levelOf(d, levelId);
      const src = plain(lv.objects).filter((o) => ids.includes(o.id));
      for (let k = 1; k <= count; k++)
        for (const o of src) {
          const id = newId('obj');
          newIds.push(id);
          const { groupId: _g, locked: _l, ...rest } = o;
          lv.objects.push({
            ...rest,
            id,
            position: [
              o.position[0] + Math.round(step[0] * k),
              o.position[1],
              o.position[2] + Math.round(step[1] * k),
            ],
          });
        }
    },
  };
}

// ── 樓層（LVL-01）─────────────────────────────────────────────────

/** 新增樓層：預設疊在最上層之上（樓高＋樓板厚）；copyWallsFrom 可複製下層外牆 */
export function addLevel(opts: { name?: string; height?: number; copyWallsFrom?: string } = {}): Command & {
  levelId: string;
} {
  const levelId = newId('lvl');
  return {
    id: cid('addLevel'),
    label: 'command.addLevel',
    levelId,
    do: (d) => {
      const top = [...d.levels].sort((a, b) => b.elevation - a.elevation)[0]!;
      const elevation = top.elevation + top.height + (top.slabThickness ?? 150);
      const src = opts.copyWallsFrom ? d.levels.find((l) => l.id === opts.copyWallsFrom) : undefined;
      const walls: Wall[] = src
        ? plain(src.walls)
            .filter((w) => w.type === 'exterior' || w.type === 'structural')
            .map((w) => ({ ...structuredClone(w), id: newId('w') }))
        : [];
      const lvl: Level = {
        id: levelId,
        name: opts.name ?? `${d.levels.length + 1}F`,
        elevation,
        height: opts.height ?? top.height,
        slabThickness: top.slabThickness ?? 150,
        walls,
        openings: [],
        rooms: [],
        objects: [],
      };
      lvl.rooms = syncRooms(lvl);
      d.levels.push(lvl as Draft<Level>);
    },
  };
}

export function updateLevel(
  levelId: string,
  patch: Partial<Pick<Level, 'name' | 'height' | 'elevation' | 'slabThickness'>>,
): Command {
  return {
    id: cid('updateLevel'),
    label: 'command.updateLevel',
    do: (d) => {
      const lv = levelOf(d, levelId);
      if (patch.height !== undefined) {
        const need = Math.max(
          0,
          ...lv.openings.map((o) => (o.sill ?? 0) + o.height),
          ...lv.walls.map((w) => w.height ?? 0),
        );
        if (patch.height < 1800 || patch.height > 6000 || patch.height < need)
          throw new CommandRejected([
            {
              code: 'LEVEL_HEIGHT_INVALID',
              id: levelId,
              message: '樓高需介於 180–600 公分且不低於門窗與牆高',
            },
          ]);
      }
      Object.assign(lv, patch);
      // 上方樓層跟著調整標高（保持堆疊）
      if (patch.height !== undefined || patch.slabThickness !== undefined) {
        const sorted = [...d.levels].sort((a, b) => a.elevation - b.elevation);
        for (let i = 1; i < sorted.length; i++) {
          const below = sorted[i - 1]!;
          sorted[i]!.elevation = below.elevation + below.height + (below.slabThickness ?? 150);
        }
      }
    },
  };
}

export function deleteLevel(levelId: string): Command {
  return {
    id: cid('deleteLevel'),
    label: 'command.deleteLevel',
    do: (d) => {
      if (d.levels.length <= 1)
        throw new CommandRejected([{ code: 'LAST_LEVEL', id: levelId, message: '至少要保留一個樓層' }]);
      const i = d.levels.findIndex((l) => l.id === levelId);
      if (i < 0) throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: '找不到樓層' }]);
      d.levels.splice(i, 1);
    },
  };
}

/** 複製整層（放在最上層之上） */
export function duplicateLevel(levelId: string): Command & { levelId: string } {
  const nid = newId('lvl');
  return {
    id: cid('duplicateLevel'),
    label: 'command.duplicateLevel',
    levelId: nid,
    do: (d) => {
      const src = plain(d.levels.find((l) => l.id === levelId));
      if (!src) throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: '找不到樓層' }]);
      const top = [...d.levels].sort((a, b) => b.elevation - a.elevation)[0]!;
      const wallMap = new Map(src.walls.map((w) => [w.id, newId('w')]));
      const lvl: Level = {
        ...structuredClone(src),
        id: nid,
        name: `${src.name ?? ''} copy`.trim(),
        elevation: top.elevation + top.height + (top.slabThickness ?? 150),
        walls: src.walls.map((w) => ({ ...structuredClone(w), id: wallMap.get(w.id)! })),
        openings: src.openings.map((o) => ({
          ...structuredClone(o),
          id: newId('o'),
          wallId: wallMap.get(o.wallId)!,
        })),
        objects: src.objects.map((o) => ({ ...structuredClone(o), id: newId('obj') })),
        rooms: [],
        annotations: (src.annotations ?? []).map((a) => ({ ...structuredClone(a), id: newId('ann') })),
      };
      const oldRooms = src.rooms;
      lvl.rooms = syncRooms(lvl).map((r) => {
        const old = oldRooms.find(
          (o) =>
            o.wallIds
              .map((w) => wallMap.get(w))
              .sort()
              .join('|') === [...r.wallIds].sort().join('|'),
        );
        return old ? { ...structuredClone(old), id: r.id, wallIds: r.wallIds } : r;
      });
      d.levels.push(lvl as Draft<Level>);
    },
  };
}

// ── 相機書籤（V3D-09）─────────────────────────────────────────────

export function updateCamera(cameraId: string, patch: { name?: string }): Command {
  return {
    id: cid('camera'),
    label: 'command.updateCamera',
    do: (d) => {
      const c = d.cameras?.find((x) => x.id === cameraId);
      if (!c) throw new CommandRejected([{ code: 'TARGET_NOT_FOUND', id: cameraId, message: '找不到視角' }]);
      Object.assign(c, patch);
    },
  };
}
export function deleteCamera(cameraId: string): Command {
  return {
    id: cid('camera'),
    label: 'command.deleteCamera',
    do: (d) => {
      d.cameras = (d.cameras ?? []).filter((c) => c.id !== cameraId);
    },
  };
}

// ── 報價設定（DOC-01；存於 scene.meta.quote）─────────────────────

export interface QuoteSettings {
  /** 目錄 id 或材質 id → 自訂單價（TWD） */
  prices?: Record<string, number>;
  taxRate?: number;
  discount?: number;
  /** 設計費、施工費等其他費用 */
  extras?: { label: string; amount: number }[];
  note?: string;
  client?: string;
}
export function setQuote(patch: QuoteSettings): Command {
  return {
    id: cid('quote'),
    label: 'command.quote',
    do: (d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      meta.quote = { ...((meta.quote as QuoteSettings | undefined) ?? {}), ...patch };
      d.meta = meta as Draft<Scene>['meta'];
    },
  };
}
export const quoteOf = (scene: Scene): QuoteSettings =>
  (scene.meta as { quote?: QuoteSettings } | undefined)?.quote ?? {};
