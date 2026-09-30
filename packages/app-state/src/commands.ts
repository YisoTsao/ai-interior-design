import type { Draft } from 'immer';
import { current, isDraft } from 'immer';
import {
  newId,
  type Environment,
  type Level,
  type Opening,
  type Room,
  type Scene,
  type SceneObject,
  type Wall,
} from '@interiorai/scene-schema';
import {
  detectRooms,
  mergeCollinearWalls,
  moveWallVertex as geoMoveVertex,
  resizeWall as geoResize,
  wallLength,
  type EndRef,
  type Vec2,
} from '@interiorai/core-geometry';
import { CommandRejected, type Command } from './history.js';

let seq = 0;
const cid = (kind: string) => `${kind}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const DEFAULTS = {
  wallThickness: 100,
  exteriorThickness: 200,
  floorMaterialId: 'mat_wood_oak',
  wallMaterialId: 'mat_paint_white',
  doorWidth: 900,
  doorHeight: 2100,
  windowWidth: 1200,
  windowHeight: 1200,
  windowSill: 900,
} as const;

const plain = <T>(v: T): T => (isDraft(v) ? (current(v as Draft<T>) as T) : v);
const levelOf = (d: Draft<Scene>, levelId: string): Draft<Level> => {
  const l = d.levels.find((x) => x.id === levelId);
  if (!l)
    throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: `找不到樓層 ${levelId}` }]);
  return l;
};
/** 套用 patch；值為 undefined 的鍵視為「恢復預設」而刪除（不在 Scene 留下 undefined） */
const assignPatch = <T extends object>(target: T, patch: Partial<T>) => {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (target as Record<string, unknown>)[k];
    else (target as Record<string, unknown>)[k] = v;
  }
};
const replaceLevel = (target: Draft<Level>, next: Level) => {
  target.walls = next.walls as Draft<Wall>[];
  target.openings = next.openings as Draft<Opening>[];
  target.rooms = next.rooms as Draft<Room>[];
};

/**
 * 牆圖改變後同步 Room：依 wallIds 鍵比對既有房間（保留名稱/材質）；
 * 鍵改變時繼承共用牆最多的舊房間屬性；新房間給預設地板材質。
 */
export function syncRooms(level: Level): Room[] {
  const detected = detectRooms(level).rooms;
  const old = level.rooms;
  const keyOf = (r: Room) => [...r.wallIds].sort().join('|');
  const used = new Set<string>();
  return detected.map((d) => {
    const exact = old.find((r) => keyOf(r) === d.key && !used.has(r.id));
    const best =
      exact ??
      old
        .filter((r) => !used.has(r.id))
        .map((r) => ({ r, shared: r.wallIds.filter((w) => d.wallIds.includes(w)).length }))
        .filter((x) => x.shared >= 2)
        .sort((a, b) => b.shared - a.shared)[0]?.r;
    if (best) used.add(best.id);
    return {
      ...(best ?? { id: newId('r'), floorMaterialId: DEFAULTS.floorMaterialId }),
      wallIds: d.wallIds,
    };
  });
}

const withRooms = (lv: Draft<Level>) => {
  lv.rooms = syncRooms(plain(lv) as Level) as Draft<Room>[];
};

/** 連續畫牆：points 為頂點序列；closed 時首尾相連 */
export function addWalls(
  levelId: string,
  points: Vec2[],
  opts: { closed?: boolean; thickness?: number; type?: Wall['type'] } = {},
): Command {
  return {
    id: cid('addWalls'),
    label: 'command.addWalls',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const pts = opts.closed ? [...points, points[0]!] : points;
      const before = lv.walls.length;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const w: Wall = {
          id: newId('w'),
          a: [a[0], a[1]],
          b: [b[0], b[1]],
          thickness: opts.thickness ?? DEFAULTS.wallThickness,
          type: opts.type ?? 'partition',
          materialId: DEFAULTS.wallMaterialId,
          materialIdB: DEFAULTS.wallMaterialId,
        };
        if (wallLength(w) < 100)
          throw new CommandRejected([
            { code: 'WALL_TOO_SHORT', id: w.id, message: '牆太短了（至少 10 公分）' },
          ]);
        lv.walls.push(w);
      }
      if (lv.walls.length === before) return; // 全為重複點：不產生變更
      const merged = mergeCollinearWalls(plain(lv) as Level);
      replaceLevel(lv, merged);
      withRooms(lv);
    },
  };
}

export function addRectRoom(levelId: string, a: Vec2, b: Vec2, thickness?: number): Command {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  const c = addWalls(
    levelId,
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    { closed: true, thickness },
  );
  return { ...c, id: cid('addRect'), label: 'command.addRectRoom' };
}

const rejectOn = (r: { violations: { code: string; id: string; message: string }[] }) => {
  if (r.violations.length) throw new CommandRejected(r.violations);
};

export function moveWallVertex(levelId: string, ref: EndRef, to: Vec2): Command {
  return {
    id: cid('moveVertex'),
    label: 'command.moveWallVertex',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const r = geoMoveVertex(plain(lv) as Level, ref, to);
      rejectOn(r);
      replaceLevel(lv, r.level);
      withRooms(lv);
    },
  };
}

export function resizeWall(
  levelId: string,
  wallId: string,
  length: number,
  keep: 'start' | 'end' | 'center' = 'start',
): Command {
  return {
    id: cid('resizeWall'),
    label: 'command.resizeWall',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const r = geoResize(plain(lv) as Level, wallId, Math.round(length), keep);
      rejectOn(r);
      replaceLevel(lv, r.level);
      withRooms(lv);
    },
  };
}

/** 整面牆平移（拖曳牆身） */
export function translateWall(levelId: string, wallId: string, delta: Vec2): Command {
  return {
    id: cid('translateWall'),
    label: 'command.translateWall',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const w = plain(lv).walls.find((x) => x.id === wallId);
      if (!w) throw new CommandRejected([{ code: 'WALL_NOT_FOUND', id: wallId, message: '找不到牆' }]);
      let cur = plain(lv) as Level;
      for (const end of ['a', 'b'] as const) {
        const p = cur.walls.find((x) => x.id === wallId)![end] as Vec2;
        const r = geoMoveVertex(cur, { wallId, end }, [p[0] + delta[0], p[1] + delta[1]]);
        rejectOn(r);
        cur = r.level;
      }
      replaceLevel(lv, cur);
      withRooms(lv);
    },
  };
}

export function updateWall(
  levelId: string,
  wallId: string,
  patch: Partial<
    Pick<
      Wall,
      | 'thickness'
      | 'type'
      | 'materialId'
      | 'materialIdB'
      | 'height'
      | 'baseboard'
      | 'appearance'
      | 'appearanceB'
    >
  >,
): Command {
  return {
    id: cid('updateWall'),
    label: 'command.updateWall',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const w = lv.walls.find((x) => x.id === wallId);
      if (!w) throw new CommandRejected([{ code: 'WALL_NOT_FOUND', id: wallId, message: '找不到牆' }]);
      if (
        patch.thickness !== undefined &&
        (patch.thickness < 20 || patch.thickness > 600 || patch.thickness >= wallLength(w))
      )
        throw new CommandRejected([
          { code: 'THICKNESS_OUT_OF_RANGE', id: wallId, message: '牆厚需介於 20–600 mm 且小於牆長' },
        ]);
      if (patch.height !== undefined) {
        const top = Math.max(
          0,
          ...lv.openings.filter((o) => o.wallId === wallId).map((o) => (o.sill ?? 0) + o.height),
        );
        if (patch.height < 100 || patch.height > lv.height || patch.height < top)
          throw new CommandRejected([
            {
              code: 'WALL_HEIGHT_OUT_OF_RANGE',
              id: wallId,
              message: '牆高需介於 100 mm 與樓層高度之間，且不能低於牆上的門窗',
            },
          ]);
      }
      assignPatch(w, patch);
    },
  };
}

function openingFits(level: Level, o: Opening): string | null {
  const w = level.walls.find((x) => x.id === o.wallId);
  if (!w) return '找不到要放置的牆';
  if (o.offset < 0 || o.offset + o.width > wallLength(w)) return '門窗超出牆的範圍';
  if ((o.sill ?? 0) + o.height > level.height) return '門窗高度超過樓層高度';
  const clash = level.openings.some(
    (x) =>
      x.id !== o.id &&
      x.wallId === o.wallId &&
      x.offset < o.offset + o.width &&
      o.offset < x.offset + x.width,
  );
  return clash ? '和同一面牆上的其他門窗重疊了' : null;
}

export function addOpening(levelId: string, o: Omit<Opening, 'id'> & { id?: string }): Command {
  return {
    id: cid('addOpening'),
    label: o.type === 'window' ? 'command.addWindow' : 'command.addDoor',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const op: Opening = { ...o, id: o.id ?? newId('o'), offset: Math.round(o.offset) };
      const err = openingFits(plain(lv) as Level, op);
      if (err) throw new CommandRejected([{ code: 'OPENING_INVALID', id: op.id, message: err }]);
      lv.openings.push(op);
    },
  };
}

export function updateOpening(
  levelId: string,
  openingId: string,
  patch: Partial<Omit<Opening, 'id'>>,
): Command {
  return {
    id: cid('updateOpening'),
    label: 'command.updateOpening',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const idx = lv.openings.findIndex((x) => x.id === openingId);
      if (idx < 0)
        throw new CommandRejected([{ code: 'OPENING_NOT_FOUND', id: openingId, message: '找不到門窗' }]);
      const next = { ...plain(lv.openings[idx]!) } as Opening;
      assignPatch(next, patch);
      if (patch.offset !== undefined) next.offset = Math.round(patch.offset);
      const err = openingFits(plain(lv) as Level, next);
      if (err) throw new CommandRejected([{ code: 'OPENING_INVALID', id: openingId, message: err }]);
      lv.openings[idx] = next;
    },
  };
}

export function addObject(levelId: string, o: Omit<SceneObject, 'id'> & { id?: string }): Command {
  return {
    id: cid('addObject'),
    label: 'command.addObject',
    do: (d) => {
      const obj: SceneObject = {
        ...o,
        id: o.id ?? newId('obj'),
        position: o.position.map(Math.round) as SceneObject['position'],
        scale: o.scale ?? [1, 1, 1],
      };
      levelOf(d, levelId).objects.push(obj);
    },
  };
}

export interface Transform {
  position?: [number, number, number];
  rotationY?: number;
  scale?: [number, number, number];
}
export function transformObject(levelId: string, objectId: string, t: Transform): Command {
  return {
    id: cid('transform'),
    label: 'command.transformObject',
    do: (d) => {
      const o = levelOf(d, levelId).objects.find((x) => x.id === objectId);
      if (!o) throw new CommandRejected([{ code: 'OBJECT_NOT_FOUND', id: objectId, message: '找不到物件' }]);
      if (o.locked)
        throw new CommandRejected([{ code: 'OBJECT_LOCKED', id: objectId, message: '物件已鎖定' }]);
      if (t.position) o.position = t.position.map(Math.round) as SceneObject['position'];
      if (t.rotationY !== undefined) o.rotationY = t.rotationY;
      if (t.scale) {
        if (t.scale.some((s) => !(s > 0)))
          throw new CommandRejected([{ code: 'SCALE_INVALID', id: objectId, message: '縮放必須大於 0' }]);
        o.scale = [...t.scale];
      }
    },
  };
}

export function updateObject(
  levelId: string,
  objectId: string,
  patch: Partial<
    Pick<SceneObject, 'params' | 'materialOverrides' | 'locked' | 'roomId' | 'name' | 'appearance' | 'light'>
  >,
): Command {
  return {
    id: cid('updateObject'),
    label: 'command.updateObject',
    do: (d) => {
      const o = levelOf(d, levelId).objects.find((x) => x.id === objectId);
      if (!o) throw new CommandRejected([{ code: 'OBJECT_NOT_FOUND', id: objectId, message: '找不到物件' }]);
      assignPatch(o, patch);
    },
  };
}

/** 房間的名稱與地板／天花外觀 */
export function updateRoom(
  levelId: string,
  roomId: string,
  patch: Partial<Pick<Room, 'floorAppearance' | 'ceilingAppearance'>>,
): Command {
  return {
    id: cid('updateRoom'),
    label: 'command.updateRoom',
    do: (d) => {
      const r = levelOf(d, levelId).rooms.find((x) => x.id === roomId);
      if (!r) throw new CommandRejected([{ code: 'ROOM_NOT_FOUND', id: roomId, message: '找不到房間' }]);
      assignPatch(r, patch);
    },
  };
}

/** 場景環境（天空、曝光、環境光、太陽）；patch 中 undefined 的鍵恢復預設 */
export function setEnvironment(patch: Partial<Environment>): Command {
  return {
    id: cid('environment'),
    label: 'command.environment',
    do: (d) => {
      const env = { ...(d.environment ?? {}) };
      assignPatch(env, patch);
      if (Object.keys(env).length) d.environment = env;
      else delete d.environment;
    },
  };
}

/** 刪除牆時連同其開口；房間重新同步 */
export function deleteEntities(levelId: string, ids: readonly string[]): Command {
  return {
    id: cid('delete'),
    label: 'command.delete',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const set = new Set(ids);
      const wallsRemoved = lv.walls.some((w) => set.has(w.id));
      lv.walls = lv.walls.filter((w) => !set.has(w.id));
      lv.openings = lv.openings.filter((o) => !set.has(o.id) && !set.has(o.wallId));
      lv.objects = lv.objects.filter((o) => !set.has(o.id));
      if (wallsRemoved) withRooms(lv);
    },
  };
}

/** 複製物件（Ctrl/Cmd+D），位移 200 mm */
export function duplicateObjects(
  levelId: string,
  ids: readonly string[],
  offset: Vec2 = [200, 200],
): Command & { newIds: string[] } {
  const newIds: string[] = [];
  return {
    id: cid('duplicate'),
    label: 'command.duplicate',
    newIds,
    do: (d) => {
      const lv = levelOf(d, levelId);
      newIds.length = 0;
      for (const o of plain(lv.objects).filter((x) => ids.includes(x.id))) {
        const id = newId('obj');
        newIds.push(id);
        lv.objects.push({
          ...o,
          id,
          position: [o.position[0] + offset[0], o.position[1], o.position[2] + offset[1]],
        });
      }
    },
  };
}

export type MaterialTarget =
  | { kind: 'wall'; id: string; side: 'A' | 'B' | 'both' }
  | { kind: 'floor' | 'ceiling'; roomId: string }
  | { kind: 'object'; id: string; slot: string };

export function setMaterial(levelId: string, target: MaterialTarget, materialId: string): Command {
  return {
    id: cid('setMaterial'),
    label: 'command.setMaterial',
    do: (d) => {
      const lv = levelOf(d, levelId);
      const miss = (id: string) =>
        new CommandRejected([{ code: 'TARGET_NOT_FOUND', id, message: '找不到要套用材質的對象' }]);
      if (target.kind === 'wall') {
        const w = lv.walls.find((x) => x.id === target.id);
        if (!w) throw miss(target.id);
        if (target.side !== 'B') w.materialId = materialId;
        if (target.side !== 'A') w.materialIdB = materialId;
      } else if (target.kind === 'object') {
        const o = lv.objects.find((x) => x.id === target.id);
        if (!o) throw miss(target.id);
        o.materialOverrides = { ...(o.materialOverrides ?? {}), [target.slot]: materialId };
      } else {
        const r = lv.rooms.find((x) => x.id === target.roomId);
        if (!r) throw miss(target.roomId);
        if (target.kind === 'floor') r.floorMaterialId = materialId;
        else r.ceilingMaterialId = materialId;
      }
    },
  };
}

export function renameRoom(levelId: string, roomId: string, label: string): Command {
  return {
    id: cid('renameRoom'),
    label: 'command.renameRoom',
    do: (d) => {
      const r = levelOf(d, levelId).rooms.find((x) => x.id === roomId);
      if (!r) throw new CommandRejected([{ code: 'ROOM_NOT_FOUND', id: roomId, message: '找不到房間' }]);
      r.label = label.slice(0, 40);
    },
  };
}

export function saveCameraBookmark(cam: {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
}): Command {
  return {
    id: cid('camera'),
    label: 'command.saveCamera',
    do: (d) => {
      d.cameras = [
        ...(d.cameras ?? []),
        {
          id: newId('cam'),
          ...cam,
          position: cam.position.map(Math.round) as [number, number, number],
          target: cam.target.map(Math.round) as [number, number, number],
        },
      ];
    },
  };
}
