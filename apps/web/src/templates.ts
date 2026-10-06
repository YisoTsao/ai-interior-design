import {
  activeLevel,
  addOpening,
  addWalls,
  autoDecorate,
  createEditorStore,
  planDecor,
  planFurnish,
  renameRoom,
  setMaterial,
  updateLevel,
  updateRoom,
  updateWall,
  type FurnishStyle,
} from '@interiorai/app-state';
import { closestOnSegment, detectRooms, pointInPolygon, type Vec2 } from '@interiorai/core-geometry';
import type { RoomKind, Scene } from '@interiorai/scene-schema';
import { catalog } from './catalogData';

/**
 * 範本庫（FE-PRJ-03／FE-PRJ-04）：以少量宣告（外框、隔間、門窗、房間）描述戶型，
 * 全部透過 Command 建立（保證通過驗證），再以自動佈置引擎依風格擺好家具與燈具。
 */
export const TEMPLATE_IDS = ['studio', 'twoBed', 'threeBed'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

interface Plan {
  outer: [number, number];
  partitions: [Vec2, Vec2][];
  doors: { at: Vec2; w: number; swing?: 'left' | 'right'; style?: 'sliding' }[];
  windows: { at: Vec2; w: number; h: number; sill: number }[];
  rooms: { at: Vec2; name: string; kind: RoomKind; floor: string }[];
}

const PLANS: Record<TemplateId, Plan> = {
  // 開放式套房（約 9 坪）：一房一衛
  studio: {
    outer: [6000, 5000],
    partitions: [
      [
        [0, 3200],
        [2200, 3200],
      ],
      [
        [2200, 3200],
        [2200, 5000],
      ],
    ],
    doors: [
      { at: [4800, 0], w: 1000, swing: 'left' },
      { at: [1100, 3200], w: 800, swing: 'right' },
    ],
    windows: [
      { at: [4100, 5000], w: 2400, h: 1600, sill: 600 },
      { at: [6000, 2000], w: 1500, h: 1200, sill: 900 },
      { at: [1100, 5000], w: 600, h: 600, sill: 1500 },
    ],
    rooms: [
      { at: [3800, 1800], name: 'studio', kind: 'living', floor: 'wood_natural_oak_plank' },
      { at: [1000, 4100], name: 'bath', kind: 'bath', floor: 'mat_tile_white' },
    ],
  },
  // 兩房一廳一衛＋廚房（約 22 坪）
  twoBed: {
    outer: [9600, 8000],
    partitions: [
      [
        [0, 4600],
        [9600, 4600],
      ],
      [
        [4800, 4600],
        [4800, 8000],
      ],
      [
        [6600, 0],
        [6600, 4600],
      ],
      [
        [6600, 2600],
        [9600, 2600],
      ],
    ],
    doors: [
      { at: [3000, 0], w: 1000, swing: 'left' },
      { at: [2400, 4600], w: 900, swing: 'right' },
      { at: [5700, 4600], w: 900, swing: 'left' },
      { at: [6600, 1300], w: 1200, style: 'sliding' },
      { at: [6600, 3600], w: 800, swing: 'right' },
    ],
    windows: [
      { at: [2400, 8000], w: 1800, h: 1500, sill: 800 },
      { at: [7200, 8000], w: 2400, h: 1500, sill: 800 },
      { at: [1500, 0], w: 1800, h: 1600, sill: 600 },
      { at: [9600, 1300], w: 1200, h: 1000, sill: 1000 },
      { at: [9600, 3600], w: 600, h: 600, sill: 1500 },
    ],
    rooms: [
      { at: [3300, 2300], name: 'living', kind: 'living', floor: 'wood_natural_oak_plank' },
      { at: [2400, 6300], name: 'bed2', kind: 'bedroom', floor: 'wood_ash_plank' },
      { at: [7200, 6300], name: 'bed1', kind: 'bedroom', floor: 'wood_ash_plank' },
      { at: [8100, 1300], name: 'kitchen', kind: 'kitchen', floor: 'mat_tile_grey60' },
      { at: [8100, 3600], name: 'bath', kind: 'bath', floor: 'mat_tile_white' },
    ],
  },
  // 三房兩廳一衛＋廚房（約 33 坪）
  threeBed: {
    outer: [12000, 9000],
    partitions: [
      [
        [0, 5500],
        [12000, 5500],
      ],
      [
        [3600, 5500],
        [3600, 9000],
      ],
      [
        [7200, 5500],
        [7200, 9000],
      ],
      [
        [8400, 0],
        [8400, 5500],
      ],
      [
        [8400, 3000],
        [12000, 3000],
      ],
    ],
    doors: [
      { at: [4000, 0], w: 1000, swing: 'left' },
      { at: [1800, 5500], w: 900, swing: 'right' },
      { at: [5400, 5500], w: 900, swing: 'left' },
      { at: [7800, 5500], w: 900, swing: 'right' },
      { at: [8400, 1500], w: 1400, style: 'sliding' },
      { at: [8400, 4200], w: 800, swing: 'left' },
    ],
    windows: [
      { at: [1800, 9000], w: 1500, h: 1500, sill: 800 },
      { at: [5400, 9000], w: 1500, h: 1500, sill: 800 },
      { at: [9600, 9000], w: 2400, h: 1500, sill: 800 },
      { at: [2000, 0], w: 2400, h: 1800, sill: 500 },
      { at: [6600, 0], w: 1800, h: 1600, sill: 600 },
      { at: [12000, 1500], w: 1200, h: 1000, sill: 1000 },
      { at: [12000, 4200], w: 600, h: 600, sill: 1500 },
    ],
    rooms: [
      { at: [4200, 2700], name: 'living', kind: 'living', floor: 'wood_natural_oak_wide_plank' },
      { at: [1800, 7200], name: 'bed3', kind: 'study', floor: 'wood_ash_plank' },
      { at: [5400, 7200], name: 'bed2', kind: 'bedroom', floor: 'wood_ash_plank' },
      { at: [9600, 7200], name: 'bed1', kind: 'bedroom', floor: 'wood_walnut_plank' },
      { at: [10200, 1500], name: 'kitchen', kind: 'kitchen', floor: 'mat_tile_grey60' },
      { at: [10200, 4200], name: 'bath', kind: 'bath', floor: 'mat_tile_white' },
    ],
  },
};

/** 樣板的總面積（坪＝3.3058 m²）與房數：卡片摘要用 */
export const templateInfo = (id: TemplateId) => {
  const p = PLANS[id];
  return { areaM2: (p.outer[0] * p.outer[1]) / 1e6, rooms: p.rooms.length };
};

export function buildTemplateScene(
  id: TemplateId,
  o: { names: (key: string) => string; style?: FurnishStyle; height?: number; furnish?: boolean },
): Scene {
  const plan = PLANS[id];
  const s = createEditorStore();
  const st = s.getState();
  const L = st.levelId;
  if (o.height) st.exec(updateLevel(L, { height: o.height }));
  const [W, H] = plan.outer;
  st.exec(
    addWalls(
      L,
      [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
      ],
      { closed: true, thickness: 200, type: 'exterior' },
    ),
  );
  for (const [a, b] of plan.partitions) st.exec(addWalls(L, [a, b], { thickness: 120 }));
  const lv = () => activeLevel(s.getState());
  for (const w of lv().walls.filter((x) => x.type === 'exterior'))
    st.exec(updateWall(L, w.id, { materialIdB: 'mat_paint_grey' }));
  /** 包含該點的牆（T 型接點不切牆 → 取最長者），回傳牆與沿 a→b 的距離 */
  const wallAt = (p: Vec2) => {
    let best: { id: string; along: number; len: number } | null = null;
    for (const w of lv().walls) {
      const c = closestOnSegment(p, w.a as Vec2, w.b as Vec2);
      if (c.distance > w.thickness / 2 + 1) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (!best || len > best.len) best = { id: w.id, along: c.t * len, len };
    }
    return best;
  };
  for (const d of plan.doors) {
    const w = wallAt(d.at);
    if (!w) continue;
    st.exec(
      addOpening(L, {
        wallId: w.id,
        type: 'door',
        offset: w.along - d.w / 2,
        width: d.w,
        height: 2100,
        sill: 0,
        ...(d.swing ? { swing: d.swing } : {}),
        ...(d.style ? { style: d.style } : {}),
      }),
    );
  }
  for (const win of plan.windows) {
    const w = wallAt(win.at);
    if (!w) continue;
    st.exec(
      addOpening(L, {
        wallId: w.id,
        type: 'window',
        offset: w.along - win.w / 2,
        width: win.w,
        height: win.h,
        sill: win.sill,
      }),
    );
  }
  const detected = detectRooms(lv()).rooms;
  for (const r of plan.rooms) {
    const d = detected.find((x) => pointInPolygon(r.at, x.floor));
    const room = d && lv().rooms.find((x) => [...x.wallIds].sort().join('|') === d.key);
    if (!room) continue;
    st.exec(renameRoom(L, room.id, o.names(r.name)));
    st.exec(updateRoom(L, room.id, { kind: r.kind }));
    st.exec(setMaterial(L, { kind: 'floor', roomId: room.id }, r.floor));
  }
  if (o.furnish !== false) {
    const f = planFurnish(lv(), catalog, { style: o.style ?? 'modern' });
    if (f.placements.length) st.exec(autoDecorate(L, f.placements));
    const deco = planDecor(lv(), catalog);
    if (deco.length) st.exec(autoDecorate(L, deco));
  }
  return s.getState().scene;
}
