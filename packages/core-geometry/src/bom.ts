import type { Scene } from '@interiorai/scene-schema';
import { detectRooms } from './rooms.js';
import { wallLength } from './walls.js';

export interface CatalogEntry {
  id: string;
  name?: string;
  /** 單價（新台幣整數元）；未知時省略 */
  unitPriceTwd?: number;
}
export interface Catalog {
  get(id: string): CatalogEntry | undefined;
}
export interface MaterialPrice {
  /** 每平方公尺單價（新台幣整數元） */
  pricePerM2Twd?: number;
}

export type BomUnit = 'pcs' | 'm2';
export interface BomLine {
  kind: 'object' | 'wall_finish' | 'floor_finish';
  key: string;
  quantity: number;
  unit: BomUnit;
  unitPriceTwd?: number;
  subtotalTwd?: number;
}
export interface BOM {
  lines: BomLine[];
  totalTwd: number;
  /** 沒有價格資料的項目（不計入總價） */
  unpricedKeys: string[];
}

const MM2_PER_M2 = 1_000_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * BOM 骨架（S1.8）：純函式；數量全由場景計算，不經 LLM（B6.4）。完整估價在 P6。
 * - 物件：依 catalogId 計數
 * - 牆面：每面牆「長×樓高−開口」×2 面（materialId/materialIdB），單位 m²
 * - 地板：偵測房間的淨面積，依 Room.floorMaterialId（以 wallIds 比對），單位 m²
 */
export function computeBOM(
  scene: Scene,
  catalog: Catalog,
  materials: Record<string, MaterialPrice> = {},
): BOM {
  const qty = new Map<string, BomLine>();
  const addLine = (kind: BomLine['kind'], key: string, q: number, unit: BomUnit) => {
    const k = `${kind}:${key}`;
    const cur = qty.get(k) ?? { kind, key, quantity: 0, unit };
    cur.quantity += q;
    qty.set(k, cur);
  };

  for (const lvl of scene.levels) {
    for (const o of lvl.objects) addLine('object', o.catalogId, 1, 'pcs');
    for (const w of lvl.walls) {
      const openingArea = lvl.openings
        .filter((o) => o.wallId === w.id)
        .reduce((s, o) => s + o.width * o.height, 0);
      const face = Math.max(0, wallLength(w) * lvl.height - openingArea) / MM2_PER_M2;
      if (w.materialId) addLine('wall_finish', w.materialId, face, 'm2');
      if (w.materialIdB) addLine('wall_finish', w.materialIdB, face, 'm2');
    }
    const detected = detectRooms(lvl).rooms;
    for (const r of lvl.rooms) {
      if (!r.floorMaterialId) continue;
      const key = [...r.wallIds].sort().join('|');
      const d = detected.find((x) => x.key === key);
      if (d) addLine('floor_finish', r.floorMaterialId, d.netArea / MM2_PER_M2, 'm2');
    }
  }

  const unpricedKeys: string[] = [];
  let totalTwd = 0;
  const lines = [...qty.values()].map((l) => {
    const line = { ...l, quantity: l.unit === 'm2' ? round2(l.quantity) : l.quantity };
    const price = l.kind === 'object' ? catalog.get(l.key)?.unitPriceTwd : materials[l.key]?.pricePerM2Twd;
    if (price === undefined) {
      unpricedKeys.push(l.key);
      return line;
    }
    const subtotalTwd = Math.round(price * line.quantity);
    totalTwd += subtotalTwd;
    return { ...line, unitPriceTwd: price, subtotalTwd };
  });
  lines.sort((a, b) => (a.kind + a.key).localeCompare(b.kind + b.key));
  return { lines, totalTwd, unpricedKeys };
}
