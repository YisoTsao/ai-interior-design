import { roomWallFaces, wallLength } from '@interiorai/core-geometry';
import {
  dimsOf,
  isPublished,
  objectName,
  roomGeometry,
  roomOfObject,
  round,
  wallName,
  wallSideInRoom,
  type AssistantCtx,
  type Compass,
} from './context.js';

/**
 * 傳給 LLM 的場景摘要（B6.4-4）：只有完成任務所需的最小資訊。
 * 不含專案名稱、使用者/組織資訊、原始平面圖、版本歷史；數字（面積、長度）由程式計算。
 */
export interface SceneSummary {
  units: 'mm';
  /** 平面方位約定：平面圖上方（−z）為北、右方（+x）為東 */
  orientation: 'north=-z,east=+x';
  levelHeightMm: number;
  rooms: { id: string; label: string | null; areaM2: number; floorMaterialId: string | null }[];
  walls: {
    id: string;
    name: string;
    lengthMm: number;
    thicknessMm: number;
    /** 相鄰房間與該牆在房間的哪一側 */
    rooms: { id: string; side: Compass | null }[];
  }[];
  openings: { id: string; type: 'door' | 'window' | 'passage'; wallId: string; widthMm: number }[];
  objects: {
    id: string;
    catalogId: string;
    name: string;
    roomId: string | null;
    position: [number, number];
    rotationDeg: number;
    sizeMm: [number, number];
    locked?: true;
  }[];
  /** 可新增的目錄項（只含已上架者） */
  catalog: { id: string; name: string; category: string }[];
  materials: { id: string; name: string; category: string }[];
}

export function summarizeScene(ctx: AssistantCtx): SceneSummary {
  const lv = ctx.level;
  const faces = new Map<string, { id: string; side: Compass | null }[]>();
  const rooms = lv.rooms.map((r) => {
    const g = roomGeometry(lv, r);
    if (g)
      for (const f of roomWallFaces(lv, g)) {
        const w = lv.walls.find((x) => x.id === f.wallId)!;
        const list = faces.get(f.wallId) ?? [];
        if (!list.some((x) => x.id === r.id)) list.push({ id: r.id, side: wallSideInRoom(lv, w, r) });
        faces.set(f.wallId, list);
      }
    return {
      id: r.id,
      label: r.label ?? null,
      areaM2: g ? Math.round(g.netArea / 10_000) / 100 : 0,
      floorMaterialId: r.floorMaterialId ?? null,
    };
  });
  return {
    units: 'mm',
    orientation: 'north=-z,east=+x',
    levelHeightMm: lv.height,
    rooms,
    walls: lv.walls.map((w) => ({
      id: w.id,
      name: wallName(lv, w),
      lengthMm: round(wallLength(w)),
      thicknessMm: w.thickness,
      rooms: faces.get(w.id) ?? [],
    })),
    openings: lv.openings.map((o) => ({ id: o.id, type: o.type, wallId: o.wallId, widthMm: o.width })),
    objects: lv.objects.map((o) => {
      const d = dimsOf(ctx, o);
      return {
        id: o.id,
        catalogId: o.catalogId,
        name: objectName(ctx, o),
        roomId: roomOfObject(ctx, o),
        position: [round(o.position[0]), round(o.position[2])],
        rotationDeg: round(((((o.rotationY * 180) / Math.PI) % 360) + 360) % 360),
        sizeMm: [round(d.w), round(d.d)],
        ...(o.locked ? { locked: true as const } : {}),
      };
    }),
    catalog: ctx.catalog
      .all()
      .filter(isPublished)
      .filter((e) => e.category !== 'openings')
      .map((e) => ({ id: e.id, name: e.nameZh, category: e.category })),
    materials: [...ctx.materials.values()].map((m) => ({ id: m.id, name: m.nameZh, category: m.category })),
  };
}
