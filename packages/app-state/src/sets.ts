import { newId } from '@interiorai/scene-schema';
import { batch } from './edit-ops.js';
import { addObject } from './commands.js';
import type { Command } from './history.js';

/**
 * 家具套組（FE-AST-06）：一鍵擺放「沙發區」「餐桌組」「床組」…，保持相對位置並設為同一群組（可解散）。
 * 位置為套組局部座標（mm；+Z＝套組正面），y 為離地高。
 */
export interface SetItem {
  catalogId: string;
  x: number;
  z: number;
  y?: number;
  rot?: number;
}
export interface FurnitureSet {
  id: string;
  items: SetItem[];
}
const PI = Math.PI;
export const FURNITURE_SETS: FurnitureSet[] = [
  {
    id: 'lounge',
    items: [
      { catalogId: 'sofa_3seat_a', x: 0, z: -900 },
      { catalogId: 'table_coffee_a', x: 0, z: 150 },
      { catalogId: 'rug_2000', x: 0, z: 0 },
      { catalogId: 'armchair_a', x: 1600, z: 250, rot: -PI / 2 },
      { catalogId: 'table_side_a', x: -1350, z: -900 },
      { catalogId: 'lamp_floor_a', x: 1350, z: -1000 },
    ],
  },
  {
    id: 'dining4',
    items: [
      { catalogId: 'table_dining_4', x: 0, z: 0 },
      { catalogId: 'chair_dining_a', x: -350, z: -650 },
      { catalogId: 'chair_dining_a', x: 350, z: -650 },
      { catalogId: 'chair_dining_a', x: -350, z: 650, rot: PI },
      { catalogId: 'chair_dining_a', x: 350, z: 650, rot: PI },
      { catalogId: 'lamp_pendant_a', x: 0, z: 0, y: 2400 },
    ],
  },
  {
    id: 'dining6',
    items: [
      { catalogId: 'table_dining_6', x: 0, z: 0 },
      ...[-600, 0, 600].flatMap((x) => [
        { catalogId: 'chair_dining_a', x, z: -700 },
        { catalogId: 'chair_dining_a', x, z: 700, rot: PI },
      ]),
      { catalogId: 'lamp_pendant_a', x: 0, z: 0, y: 2400 },
    ],
  },
  {
    id: 'bed',
    items: [
      { catalogId: 'bed_queen_180', x: 0, z: 0 },
      { catalogId: 'nightstand_a', x: -1200, z: -850 },
      { catalogId: 'nightstand_a', x: 1200, z: -850 },
      { catalogId: 'lamp_table_a', x: -1200, z: -850, y: 500 },
      { catalogId: 'lamp_table_a', x: 1200, z: -850, y: 500 },
      { catalogId: 'rug_2000', x: 0, z: 300, rot: PI / 2 },
    ],
  },
  {
    id: 'study',
    items: [
      { catalogId: 'desk_office_1400', x: 0, z: 0 },
      { catalogId: 'chair_office_a', x: 0, z: 600, rot: PI },
      { catalogId: 'monitor_27', x: 0, z: -170, y: 750 },
      { catalogId: 'cabinet_book_900', x: 1300, z: -100 },
    ],
  },
  {
    id: 'tvwall',
    items: [
      { catalogId: 'tvstand_1800', x: 0, z: 0 },
      { catalogId: 'tv_65', x: 0, z: 0, y: 500 },
      { catalogId: 'plant_tall', x: -1250, z: 0 },
      { catalogId: 'plant_tall', x: 1250, z: 0 },
    ],
  },
];

/** 套組放置：at＝世界座標中心，rotationY＝整組旋轉；回傳 Command 與新群組 id */
export function placeSet(
  levelId: string,
  set: FurnitureSet,
  at: [number, number],
  rotationY = 0,
): Command & { groupId: string; ids: string[] } {
  const groupId = newId('obj').replace('obj_', 'grp_');
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const ids: string[] = [];
  const cmds = set.items.map((it) => {
    const id = newId('obj');
    ids.push(id);
    // 與 transform 慣例一致：物件局部 +X＝(cos, −sin)、+Z＝(sin, cos)
    const x = at[0] + c * it.x + s * it.z;
    const z = at[1] - s * it.x + c * it.z;
    return addObject(levelId, {
      id,
      catalogId: it.catalogId,
      position: [Math.round(x), it.y ?? 0, Math.round(z)],
      rotationY: rotationY + (it.rot ?? 0),
      groupId,
    });
  });
  return Object.assign(batch(cmds, 'command.placeSet'), { groupId, ids });
}
