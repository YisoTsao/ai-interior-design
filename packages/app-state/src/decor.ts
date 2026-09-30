import { newId, type Level, type SceneObject } from '@interiorai/scene-schema';
import { objectDims, type Catalog, type CatalogEntry } from '@interiorai/catalog';
import {
  detectRooms,
  objectFootprint,
  openingSegment,
  overlapArea,
  pointInPolygon,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Command } from './history.js';

type Placement = Omit<SceneObject, 'id'>;

const typeOf = (e: CatalogEntry | undefined) => (e?.model.kind === 'parametric' ? e.model.type : undefined);
/** 資產庫中第一件（published）指定參數化類型的品項 */
const firstOfType = (catalog: Catalog, type: string) => catalog.all().find((e) => typeOf(e) === type);

/** 門口淨空半徑 mm：軟裝不得擋門 */
const DOOR_CLEARANCE = 1100;
/** 牆邊內縮 mm */
const INSET = 150;

/**
 * 自動點綴軟裝（盆栽、地毯、落地燈）：每個房間
 * - 沒有盆栽 → 在一個空的角落放一盆
 * - 有沙發、沒有地毯 → 沙發前方放地毯
 * - 有沙發、沒有落地燈 → 沙發側邊放落地燈
 * 候選位置須完全在房間淨地板內、不擋門、不與既有家具重疊。純函式，不修改 level。
 */
export function planDecor(level: Level, catalog: Catalog): Placement[] {
  const plant = firstOfType(catalog, 'plant');
  const rug = firstOfType(catalog, 'rug');
  const lamp = firstOfType(catalog, 'lamp_floor');
  const doors: Vec2[] = level.openings
    .filter((o) => o.type !== 'window')
    .flatMap((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) return [];
      const [p, q] = openingSegment(w, o.offset, o.width);
      return [[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Vec2];
    });

  const placed: { poly: Vec2[]; floorCovering: boolean }[] = level.objects.flatMap((o) => {
    const e = catalog.get(o.catalogId);
    if (!e || e.anchor !== 'floor') return [];
    const d = objectDims(e, o.params, o.scale);
    return [{ poly: objectFootprint(o.position, o.rotationY, d.w, d.d), floorCovering: d.h <= 30 }];
  });

  const out: Placement[] = [];
  const tryPlace = (floor: Vec2[], e: CatalogEntry, x: number, z: number, rotationY: number): boolean => {
    const d = objectDims(e);
    const poly = objectFootprint([x, 0, z], rotationY, d.w, d.d);
    if (!poly.every((p) => pointInPolygon(p, floor))) return false;
    if (doors.some((p) => Math.hypot(p[0] - x, p[1] - z) < DOOR_CLEARANCE)) return false;
    const covering = d.h <= 30;
    // 地毯可以壓在家具下；其他物件不得與非地毯物件重疊
    if (!covering && placed.some((o) => !o.floorCovering && overlapArea(poly, o.poly) > 100)) return false;
    placed.push({ poly, floorCovering: covering });
    out.push({ catalogId: e.id, position: [Math.round(x), 0, Math.round(z)], rotationY, scale: [1, 1, 1] });
    return true;
  };

  for (const room of detectRooms(level).rooms) {
    const floor = room.floor;
    const inRoom = level.objects.filter((o) => pointInPolygon([o.position[0], o.position[2]], floor));
    const has = (type: string) => inRoom.some((o) => typeOf(catalog.get(o.catalogId)) === type);
    const sofas = inRoom.filter((o) => typeOf(catalog.get(o.catalogId)) === 'sofa');

    if (plant && !has('plant')) {
      const d = objectDims(plant);
      const xs = floor.map((p) => p[0]);
      const zs = floor.map((p) => p[1]);
      const r = Math.max(d.w, d.d) / 2 + INSET;
      const corners: Vec2[] = [
        [Math.max(...xs) - r, Math.max(...zs) - r],
        [Math.min(...xs) + r, Math.max(...zs) - r],
        [Math.max(...xs) - r, Math.min(...zs) + r],
        [Math.min(...xs) + r, Math.min(...zs) + r],
      ];
      corners.some(([x, z]) => tryPlace(floor, plant, x, z, 0));
    }
    for (const s of sofas.slice(0, 1)) {
      const e = catalog.get(s.catalogId)!;
      const sd = objectDims(e, s.params, s.scale);
      // 物件正面朝局部 +Z；Three.js 繞 Y 旋轉後的前方與右方
      const fwd: Vec2 = [Math.sin(s.rotationY), Math.cos(s.rotationY)];
      const right: Vec2 = [Math.cos(s.rotationY), -Math.sin(s.rotationY)];
      if (rug && !has('rug')) {
        const rd = objectDims(rug);
        const k = sd.d / 2 + rd.d / 2 - 250;
        tryPlace(floor, rug, s.position[0] + fwd[0] * k, s.position[2] + fwd[1] * k, s.rotationY);
      }
      if (lamp && !has('lamp_floor')) {
        const ld = objectDims(lamp);
        const k = sd.w / 2 + ld.w / 2 + 120;
        const back = -sd.d / 4;
        [1, -1].some((side) =>
          tryPlace(
            floor,
            lamp,
            s.position[0] + right[0] * k * side + fwd[0] * back,
            s.position[2] + right[1] * k * side + fwd[1] * back,
            0,
          ),
        );
      }
    }
  }
  return out;
}

/** 一次加入所有軟裝（單一 undo 步驟）；沒有可放的位置時不改變 Scene */
export function autoDecorate(levelId: string, placements: readonly Placement[]): Command {
  return {
    id: `autoDecorate_${Date.now().toString(36)}`,
    label: 'command.autoDecorate',
    do: (d) => {
      const lv = d.levels.find((l) => l.id === levelId);
      if (!lv) return;
      for (const p of placements) lv.objects.push({ ...p, id: newId('obj') });
    },
  };
}
