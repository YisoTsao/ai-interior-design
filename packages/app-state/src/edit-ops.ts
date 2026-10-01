import type { Draft } from 'immer';
import { current, isDraft } from 'immer';
import { objectDims, type Catalog } from '@interiorai/catalog';
import { arcPoints, mergeWallPair, objectFootprint, splitWallAt, type Vec2 } from '@interiorai/core-geometry';
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
/** 角度標註（v1.4）：頂點 center，兩邊方向 a、b */
export interface AngleData {
  center: Vec2;
  a: Vec2;
  b: Vec2;
}
/** 箭頭（v1.4）：從 a 指向 b */
export interface ArrowData {
  a: Vec2;
  b: Vec2;
}
/** 編號標記（v1.4）：圓圈編號＋說明文字，對應「標記清單」；target＝引出線指向的點 */
export interface TagData {
  position: Vec2;
  number: number;
  text?: string;
  target?: Vec2;
}
export type AnnotationInput =
  | { type: 'dimension'; data: DimensionData }
  | { type: 'text'; data: TextData }
  | { type: 'note'; data: NoteData }
  | { type: 'angle'; data: AngleData }
  | { type: 'arrow'; data: ArrowData }
  | { type: 'tag'; data: TagData };

/** 下一個編號標記的號碼（目前最大號＋1） */
export function nextTagNumber(level: Pick<Level, 'annotations'>): number {
  const ns = (level.annotations ?? [])
    .filter((a) => a.type === 'tag')
    .map((a) => Number((a.data as { number?: unknown } | undefined)?.number))
    .filter((n) => Number.isFinite(n));
  return ns.length ? Math.max(...ns) + 1 : 1;
}

/** 兩邊夾角（度，0–180） */
export function angleDegrees(d: AngleData): number {
  const u = [d.a[0] - d.center[0], d.a[1] - d.center[1]];
  const v = [d.b[0] - d.center[0], d.b[1] - d.center[1]];
  const lu = Math.hypot(u[0]!, u[1]!);
  const lv = Math.hypot(v[0]!, v[1]!);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  const c = (u[0]! * v[0]! + u[1]! * v[1]!) / (lu * lv);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

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
  /** 材質（m² 項目）損耗率，例如 0.1＝10% */
  wastePct?: number;
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

/** 專案屬性（FE-PRJ-07）：存在 scene.meta.project */
export interface ProjectInfo {
  address?: string;
  client?: string;
  /** 預算（TWD） */
  budget?: number;
  notes?: string;
}
export function setProjectInfo(patch: ProjectInfo): Command {
  return {
    id: cid('projectInfo'),
    label: 'command.projectInfo',
    do: (d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      meta.project = { ...((meta.project as ProjectInfo | undefined) ?? {}), ...patch };
      d.meta = meta as Draft<Scene>['meta'];
    },
  };
}
export const projectInfoOf = (scene: Scene): ProjectInfo =>
  (scene.meta as { project?: ProjectInfo } | undefined)?.project ?? {};

/** 基地（FE-V3D-06 日照模擬）：緯度、經度、時區、平面圖北向、日期時間；存在 scene.meta.site */
export interface SiteInfo {
  lat: number;
  lon: number;
  /** UTC 偏移（小時） */
  tz: number;
  /** 平面圖的北方相對畫面上方順時針角度 */
  northDeg: number;
  /** 當地日期 YYYY-MM-DD */
  date: string;
  /** 當地時間（小時，可含小數） */
  hour: number;
}
export const DEFAULT_SITE: SiteInfo = {
  lat: 25.04,
  lon: 121.56,
  tz: 8,
  northDeg: 0,
  date: '2026-06-21',
  hour: 15,
};
export const siteOf = (scene: Scene): SiteInfo => ({
  ...DEFAULT_SITE,
  ...((scene.meta as { site?: Partial<SiteInfo> } | undefined)?.site ?? {}),
});
export function setSite(patch: Partial<SiteInfo>): Command {
  return {
    id: cid('site'),
    label: 'command.site',
    do: (d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      meta.site = { ...((meta.site as Partial<SiteInfo> | undefined) ?? {}), ...patch };
      d.meta = meta as Draft<Scene>['meta'];
    },
  };
}

/** 牆的層級替換（保留 draft 身分，只換陣列內容） */
const setWalls = (lv: Draft<Level>, next: Level) => {
  lv.walls = next.walls as Draft<Wall>[];
  lv.openings = next.openings as Draft<Opening>[];
  lv.rooms = syncRooms({ ...next }) as Draft<Room>[];
};

/** 在牆上插入節點（FE-PLAN-15）：offset＝距 a 端 mm；預設中點 */
export function splitWall(levelId: string, wallId: string, offset?: number): Command {
  return {
    id: cid('splitWall'),
    label: 'command.splitWall',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const cur = plain(lv) as Level;
      const w = cur.walls.find((x) => x.id === wallId);
      const L = w ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : 0;
      const r = splitWallAt(cur, wallId, offset ?? L / 2, newId('w'));
      if (r.violations.length) throw new CommandRejected(r.violations);
      setWalls(lv, r.level);
    },
  };
}

/** 合併兩面共線相接的牆（FE-PLAN-15） */
export function mergeWalls(levelId: string, aId: string, bId: string): Command {
  return {
    id: cid('mergeWalls'),
    label: 'command.mergeWalls',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const next = mergeWallPair(plain(lv) as Level, aId, bId);
      if (!next)
        throw new CommandRejected([
          { code: 'WALLS_NOT_MERGEABLE', id: aId, message: '兩面牆需共線且相接（接點不能有其他牆）' },
        ]);
      setWalls(lv, next);
    },
  };
}

/** 簡報講者備註（FE-SHR-02）：scene.meta.presentation.notes[cameraId] */
export const presentationNotesOf = (scene: Scene): Record<string, string> =>
  (scene.meta as { presentation?: { notes?: Record<string, string> } } | undefined)?.presentation?.notes ??
  {};
export function setPresentationNote(cameraId: string, text: string): Command {
  return {
    id: cid('note'),
    label: 'command.presentationNote',
    do: (d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const p = (meta.presentation as { notes?: Record<string, string> } | undefined) ?? {};
      const notes = { ...(p.notes ?? {}) };
      if (text.trim()) notes[cameraId] = text;
      else delete notes[cameraId];
      meta.presentation = { ...p, notes };
      d.meta = meta as Draft<Scene>['meta'];
    },
  };
}

/** 留言標註（FE-SHR-03）：釘在樓層座標上的討論串；存在 scene.meta.comments */
export interface CommentReply {
  id: string;
  author: string;
  text: string;
  at: string;
}
export interface CommentThread {
  id: string;
  levelId: string;
  /** 世界座標 x, z（mm）；y 為 3D 釘選高度 */
  position: [number, number, number];
  author: string;
  text: string;
  at: string;
  resolved: boolean;
  replies: CommentReply[];
}
export const commentsOf = (scene: Scene): CommentThread[] =>
  (scene.meta as { comments?: CommentThread[] } | undefined)?.comments ?? [];
const withComments = (d: Draft<Scene>, f: (list: CommentThread[]) => CommentThread[]) => {
  const meta = (d.meta ?? {}) as Record<string, unknown>;
  meta.comments = f(((meta.comments as CommentThread[] | undefined) ?? []).map((c) => ({ ...c })));
  d.meta = meta as Draft<Scene>['meta'];
};
export function addComment(
  c: Omit<CommentThread, 'id' | 'at' | 'resolved' | 'replies'> & { id?: string },
): Command & { commentId: string } {
  const id = c.id ?? newId('ann').replace('ann_', 'cmt_');
  return {
    id: cid('comment'),
    label: 'command.addComment',
    commentId: id,
    do: (d) =>
      withComments(d, (l) => [
        ...l,
        { ...c, id, at: new Date().toISOString(), resolved: false, replies: [] },
      ]),
  };
}
export function replyComment(threadId: string, author: string, text: string): Command {
  return {
    id: cid('reply'),
    label: 'command.replyComment',
    do: (d) =>
      withComments(d, (l) =>
        l.map((c) =>
          c.id === threadId
            ? {
                ...c,
                replies: [
                  ...c.replies,
                  { id: newId('ann').replace('ann_', 'rep_'), author, text, at: new Date().toISOString() },
                ],
              }
            : c,
        ),
      ),
  };
}
export function resolveComment(threadId: string, resolved: boolean): Command {
  return {
    id: cid('resolve'),
    label: 'command.resolveComment',
    do: (d) => withComments(d, (l) => l.map((c) => (c.id === threadId ? { ...c, resolved } : c))),
  };
}
export function deleteComment(threadId: string): Command {
  return {
    id: cid('delComment'),
    label: 'command.deleteComment',
    do: (d) => withComments(d, (l) => l.filter((c) => c.id !== threadId)),
  };
}

// ── 弧形牆凸度（PLAN-02）─────────────────────────────────────────

const plainObj = plain;
const plainLevel = (lv: Draft<Level> | Level): Level => plain(lv) as Level;

/** 同一 arcGroup 的牆依首尾相接排成鏈；回傳有序的牆與每段是否反向 */
export function arcChain(level: Pick<Level, 'walls'>, group: string) {
  const ws = level.walls.filter((w) => w.arcGroup === group);
  if (!ws.length) return null;
  const key = (p: readonly number[]) => `${p[0]},${p[1]}`;
  const deg = new Map<string, number>();
  for (const w of ws) for (const p of [w.a, w.b]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
  const startW = ws.find((w) => deg.get(key(w.a)) === 1) ?? ws.find((w) => deg.get(key(w.b)) === 1) ?? ws[0]!;
  let cur: Vec2 = deg.get(key(startW.a)) === 1 ? [startW.a[0], startW.a[1]] : [startW.b[0], startW.b[1]];
  const out: { w: Wall; reversed: boolean }[] = [];
  const left = new Set(ws.map((w) => w.id));
  while (left.size) {
    const next = ws.find((w) => left.has(w.id) && (key(w.a) === key(cur) || key(w.b) === key(cur)));
    if (!next) break;
    const reversed = key(next.b) === key(cur);
    out.push({ w: next, reversed });
    left.delete(next.id);
    cur = reversed ? [next.a[0], next.a[1]] : [next.b[0], next.b[1]];
  }
  const first = out[0]!;
  const last = out.at(-1)!;
  const A: Vec2 = first.reversed ? [first.w.b[0], first.w.b[1]] : [first.w.a[0], first.w.a[1]];
  const B: Vec2 = last.reversed ? [last.w.a[0], last.w.a[1]] : [last.w.b[0], last.w.b[1]];
  return { segs: out, A, B };
}

/** 弧鏈的中點（沿弧長一半處；拖曳凸度把手的位置） */
export function arcMidpoint(level: Pick<Level, 'walls'>, group: string): Vec2 | null {
  const c = arcChain(level, group);
  if (!c) return null;
  const lens = c.segs.map((s) => Math.hypot(s.w.b[0] - s.w.a[0], s.w.b[1] - s.w.a[1]));
  let half = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i]!;
    const L = lens[i]!;
    if (half <= L) {
      const p0 = s.reversed ? s.w.b : s.w.a;
      const p1 = s.reversed ? s.w.a : s.w.b;
      const t = L ? half / L : 0;
      return [Math.round(p0[0] + (p1[0] - p0[0]) * t), Math.round(p0[1] + (p1[1] - p0[1]) * t)];
    }
    half -= L;
  }
  return c.B;
}

/**
 * 調整弧形牆凸度（FE-PLAN-02）：保留兩端點（與其他牆的連接不變），以新的弧上一點重算分段；
 * 牆的厚度、材質、外觀沿用；門窗依「沿弧長的比例位置」搬到新分段（放不下的移除）。單一 undo。
 */
export function reshapeArc(levelId: string, group: string, through: Vec2): Command {
  return {
    id: cid('arc'),
    label: 'command.reshapeArc',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const c = arcChain(plainLevel(lv), group);
      if (!c) throw new CommandRejected([{ code: 'TARGET_NOT_FOUND', id: group, message: '找不到弧形牆' }]);
      const pts = arcPoints(c.A, c.B, through);
      if (pts.length < 3)
        throw new CommandRejected([{ code: 'ARC_DEGENERATE', id: group, message: '三點共線，無法形成弧' }]);
      const lens = c.segs.map((s) => Math.hypot(s.w.b[0] - s.w.a[0], s.w.b[1] - s.w.a[1]));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      // 門窗：沿鏈的中心位置（比例）
      const ids = new Set(c.segs.map((s) => s.w.id));
      const moved: { o: Opening; t: number }[] = [];
      let acc = 0;
      c.segs.forEach((s, i) => {
        for (const o of lv.openings.filter((x) => x.wallId === s.w.id)) {
          const mid = o.offset + o.width / 2;
          moved.push({
            o: { ...(plainObj(o) as Opening) },
            t: (acc + (s.reversed ? lens[i]! - mid : mid)) / total,
          });
        }
        acc += lens[i]!;
      });
      const proto = plainObj(c.segs[0]!.w) as Wall;
      const fresh: Wall[] = [];
      for (let i = 1; i < pts.length; i++)
        fresh.push({ ...proto, id: newId('w'), a: pts[i - 1]!, b: pts[i]! });
      lv.walls = [...lv.walls.filter((w) => !ids.has(w.id)), ...fresh] as Draft<Wall>[];
      const fLens = fresh.map((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]));
      const fTotal = fLens.reduce((a, b) => a + b, 0);
      const kept: Opening[] = [];
      for (const { o, t } of moved) {
        let s = t * fTotal;
        let k = 0;
        while (k < fresh.length - 1 && s > fLens[k]!) s -= fLens[k++]!;
        if (o.width > fLens[k]!) continue;
        const offset = Math.round(Math.max(0, Math.min(fLens[k]! - o.width, s - o.width / 2)));
        kept.push({ ...o, wallId: fresh[k]!.id, offset });
      }
      lv.openings = [...lv.openings.filter((o) => !ids.has(o.wallId)), ...kept] as Draft<Opening>[];
      lv.rooms = syncRooms(plainLevel(lv)) as Draft<Level['rooms'][number]>[];
    },
  };
}
