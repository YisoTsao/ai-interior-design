import type { Catalog } from '@interiorai/catalog';
import { newId, type Level, type LightScene, type SceneObject } from '@interiorai/scene-schema';
import { CommandRejected, type Command } from './history.js';

/**
 * 燈光群組與情境（FE-LGT-05）：
 * - 群組：燈具的 light.group 名稱，同群組一起開關／調光；
 * - 情境：一組燈的開關＋亮度比例（scene.lightScenes），一鍵切換；比例寫成 light.lumens＝目錄光通量×比例。
 * 預覽（時間軸播放）不寫入 Scene：檢視器以 withLightState 套用暫時狀態。
 */
export type LightState = { on: boolean; level?: number };
const cid = (k: string) => `${k}_${Math.random().toString(36).slice(2, 10)}`;

export const isLight = (o: SceneObject, catalog: Catalog) => !!catalog.get(o.catalogId)?.light;

/** 燈具目前的狀態（亮度比例＝覆寫光通量／目錄光通量，上限 1） */
export function lightStateOf(o: SceneObject, catalog: Catalog): LightState {
  const L = catalog.get(o.catalogId)?.light;
  const base = L?.lumens ?? 0;
  const lm = o.light?.lumens ?? base;
  return {
    on: o.light?.on !== false,
    level: base > 0 ? Math.min(1, Math.round((lm / base) * 100) / 100) : 1,
  };
}

/** 把狀態套到物件（回傳新物件；level 未指定＝保留目前光通量） */
export function withLightState(o: SceneObject, catalog: Catalog, s: LightState): SceneObject {
  const L = catalog.get(o.catalogId)?.light;
  if (!L) return o;
  const light = { ...o.light, on: s.on };
  if (s.level !== undefined) light.lumens = Math.round(L.lumens * Math.max(0, Math.min(1, s.level)));
  return { ...o, light };
}

/** 樓層中所有群組名稱（排序） */
export function lightGroups(level: Pick<Level, 'objects'>): string[] {
  return [...new Set(level.objects.map((o) => o.light?.group).filter((g): g is string => !!g))].sort();
}

/** 設定（或清除）燈具的群組 */
export function setLightGroup(levelId: string, ids: readonly string[], group: string | undefined): Command {
  return {
    id: cid('lightGroup'),
    label: 'command.lightGroup',
    do: (d) => {
      const lv = d.levels.find((l) => l.id === levelId);
      if (!lv) throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: '找不到樓層' }]);
      for (const o of lv.objects)
        if (ids.includes(o.id)) {
          const next = { ...o.light };
          if (group) next.group = group.slice(0, 40);
          else delete next.group;
          o.light = next;
        }
    },
  };
}

function applyStates(
  levelId: string,
  catalog: Catalog,
  states: Record<string, LightState>,
  label: string,
): Command {
  return {
    id: cid('lightScene'),
    label,
    do: (d) => {
      const lv = d.levels.find((l) => l.id === levelId);
      if (!lv) throw new CommandRejected([{ code: 'LEVEL_NOT_FOUND', id: levelId, message: '找不到樓層' }]);
      lv.objects.forEach((o, i) => {
        const s = states[o.id];
        if (s) lv.objects[i] = withLightState(o as SceneObject, catalog, s) as typeof o;
      });
    },
  };
}

/** 群組一起開關／調光（單一 undo） */
export function setGroupLights(
  levelId: string,
  level: Pick<Level, 'objects'>,
  catalog: Catalog,
  group: string,
  s: LightState,
): Command {
  const states: Record<string, LightState> = {};
  for (const o of level.objects) if (o.light?.group === group && isLight(o, catalog)) states[o.id] = s;
  return applyStates(levelId, catalog, states, 'command.lightGroup');
}

/** 以目前所有燈具的狀態建立情境 */
export function saveLightScene(
  name: string,
  level: Pick<Level, 'objects'>,
  catalog: Catalog,
): Command & { sceneId: string } {
  const sceneId = newId('ls');
  const states: LightScene['states'] = {};
  for (const o of level.objects) if (isLight(o, catalog)) states[o.id] = lightStateOf(o, catalog);
  return {
    sceneId,
    id: cid('lightScene'),
    label: 'command.saveLightScene',
    do: (d) => {
      const list = d.lightScenes ?? [];
      if (list.length >= 50)
        throw new CommandRejected([{ code: 'LIMIT', id: sceneId, message: '燈光情境最多 50 個' }]);
      d.lightScenes = [...list, { id: sceneId, name: name.trim().slice(0, 40) || '情境', states }];
    },
  };
}

/** 套用情境（單一 undo）；情境中沒有列出的燈維持現狀 */
export function applyLightScene(levelId: string, scene: LightScene, catalog: Catalog): Command {
  return applyStates(levelId, catalog, scene.states, 'command.applyLightScene');
}

export function deleteLightScene(id: string): Command {
  return {
    id: cid('lightScene'),
    label: 'command.deleteLightScene',
    do: (d) => {
      d.lightScenes = (d.lightScenes ?? []).filter((x) => x.id !== id);
      if (!d.lightScenes.length) delete d.lightScenes;
    },
  };
}
