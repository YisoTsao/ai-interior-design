import { newId, type Opening, type Wall } from '@interiorai/scene-schema';
import { detectRooms, pointInPolygon, wallLength, type Vec2 } from '@interiorai/core-geometry';
import { DEFAULTS, syncRooms } from './commands.js';
import type { Command } from './history.js';

/** 已換算成 mm 的匯入元素（平面圖辨識結果經使用者校正後） */
export interface ImportWall {
  key: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  exterior?: boolean;
}
export interface ImportOpening {
  wallKey: string;
  type: 'door' | 'window' | 'passage';
  offset: number;
  width: number;
  height: number;
  sill: number;
  swing?: 'left' | 'right' | 'none' | null;
}
export interface ImportLabel {
  text: string;
  position: Vec2;
}
export interface ImportSkip {
  kind: 'wall' | 'opening';
  key: string;
  reason: string;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * 匯入平面圖（S6.6）：牆與開口原樣建立（不做共線合併，避免開口 offset 失效），房間由牆自動偵測，
 * 以「落在房間內的文字」命名。不合法的元素略過並回報原因（不中斷整體匯入）。單一 undo 步驟。
 */
export function importPlan(
  levelId: string,
  input: { walls: ImportWall[]; openings: ImportOpening[]; labels: ImportLabel[] },
  report?: (skipped: ImportSkip[]) => void,
): Command {
  return {
    id: `importPlan_${Date.now().toString(36)}`,
    label: 'command.importPlan',
    do: (d) => {
      const lv = d.levels.find((l) => l.id === levelId);
      if (!lv) return;
      const skipped: ImportSkip[] = [];
      const ids = new Map<string, string>();
      const walls: Wall[] = [];
      for (const w of input.walls) {
        const wall: Wall = {
          id: newId('w'),
          a: [Math.round(w.a[0]), Math.round(w.a[1])],
          b: [Math.round(w.b[0]), Math.round(w.b[1])],
          thickness: clampInt(w.thickness, 20, 600),
          type: w.exterior ? 'exterior' : 'partition',
          materialId: DEFAULTS.wallMaterialId,
          materialIdB: DEFAULTS.wallMaterialId,
        };
        if (wallLength(wall) < 100) {
          skipped.push({ kind: 'wall', key: w.key, reason: '牆太短（< 10 cm）' });
          continue;
        }
        ids.set(w.key, wall.id);
        walls.push(wall);
      }
      const openings: Opening[] = [];
      for (const o of input.openings) {
        const wallId = ids.get(o.wallKey);
        const wall = walls.find((w) => w.id === wallId);
        if (!wall) {
          skipped.push({ kind: 'opening', key: o.wallKey, reason: '所屬的牆不存在' });
          continue;
        }
        const L = wallLength(wall);
        const width = clampInt(o.width, 300, 5000);
        const offset = clampInt(o.offset, 0, Math.max(0, L - width));
        if (width > L) {
          skipped.push({ kind: 'opening', key: o.wallKey, reason: '開口比牆長' });
          continue;
        }
        const clash = openings.some(
          (x) => x.wallId === wallId && offset < x.offset + x.width && x.offset < offset + width,
        );
        if (clash) {
          skipped.push({ kind: 'opening', key: o.wallKey, reason: '與同一道牆上的其他開口重疊' });
          continue;
        }
        openings.push({
          id: newId('o'),
          wallId: wallId!,
          type: o.type,
          offset,
          width,
          height: clampInt(o.height || (o.type === 'window' ? 1200 : 2100), 300, 6000),
          sill: clampInt(o.sill ?? 0, 0, 3000),
          ...(o.type === 'door' ? { swing: o.swing === 'right' ? 'right' : 'left' } : {}),
        } as Opening);
      }
      lv.walls = walls;
      lv.openings = openings;
      lv.objects = [];
      lv.rooms = syncRooms({ ...lv, walls, openings, rooms: [] });
      const detected = detectRooms({ walls }).rooms;
      for (const r of lv.rooms) {
        const det = detected.find((x) => x.key === [...r.wallIds].sort().join('|'));
        const hit = det && input.labels.find((l) => pointInPolygon(l.position, det.floor));
        if (hit) r.label = hit.text;
      }
      report?.(skipped);
    },
  };
}
