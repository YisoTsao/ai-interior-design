import { createStore, get, set } from 'idb-keyval';
import { migrate, validateScene, type Scene } from '@interiorai/scene-schema';
import { buildTemplateScene, templateInfo, type TemplateId } from './templates';

/**
 * 戶型庫（FE-PRJ-05）：搜尋（縣市、社區、坪數、房數）→ 預覽 → 匯入成新專案（不佈置家具）。
 *
 * 資料來源另議（規格書）：內建的是「示意戶型」——由範本外框依比例產生的通用格局，不對應任何真實建案；
 * 取得授權資料後以 JSON 匯入（每筆含縣市、社區、坪數、格局與 Scene），存在本機 IndexedDB。
 */
export interface FloorplanEntry {
  id: string;
  name: string;
  /** 格局：房、廳、衛 */
  bed: number;
  living: number;
  bath: number;
  /** 室內坪數 */
  ping: number;
  city?: string;
  community?: string;
  source: 'sample' | 'imported';
  /** 示意戶型：範本＋縮放；匯入資料：Scene 本身 */
  template?: { id: TemplateId; scale: [number, number] };
  scene?: Scene;
}

const PING = 3.3058;
const SAMPLE_BASE: { id: TemplateId; bed: number; living: number; bath: number }[] = [
  { id: 'studio', bed: 1, living: 0, bath: 1 },
  { id: 'twoBed', bed: 2, living: 1, bath: 1 },
  { id: 'threeBed', bed: 3, living: 1, bath: 1 },
];
const SCALES: [number, number][] = [
  [0.9, 0.95],
  [1, 1],
  [1.1, 1.05],
  [1.2, 1.12],
];

/** 內建示意戶型（3 種格局 × 4 種面積） */
export function sampleFloorplans(): FloorplanEntry[] {
  return SAMPLE_BASE.flatMap((b) =>
    SCALES.map((sc, i) => {
      const m2 = templateInfo(b.id).areaM2 * sc[0] * sc[1];
      return {
        id: `sample-${b.id}-${i}`,
        name: `${b.id}-${i + 1}`,
        bed: b.bed,
        living: b.living,
        bath: b.bath,
        ping: Math.round((m2 / PING) * 10) / 10,
        source: 'sample' as const,
        template: { id: b.id, scale: sc },
      };
    }),
  );
}

export interface FloorplanQuery {
  text?: string;
  city?: string;
  pingMin?: number;
  pingMax?: number;
  bed?: number;
}
export function searchFloorplans(list: readonly FloorplanEntry[], q: FloorplanQuery): FloorplanEntry[] {
  const k = q.text?.trim().toLowerCase();
  return list
    .filter(
      (e) =>
        (!q.city || e.city === q.city) &&
        (!q.pingMin || e.ping >= q.pingMin) &&
        (!q.pingMax || e.ping <= q.pingMax) &&
        (!q.bed || (q.bed >= 4 ? e.bed >= 4 : e.bed === q.bed)) &&
        (!k || [e.name, e.community ?? '', e.city ?? ''].some((x) => x.toLowerCase().includes(k))),
    )
    .sort((a, b) => a.ping - b.ping);
}

/** 建立戶型的 Scene（示意戶型不佈置家具） */
export function floorplanScene(e: FloorplanEntry, names: (k: string) => string): Scene {
  if (e.scene) return e.scene;
  return buildTemplateScene(e.template!.id, { names, furnish: false, scale: e.template!.scale });
}

// ── 匯入的授權資料集 ─────────────────────────────────────────────
const store = createStore('interiorai-floorplans', 'entries');
export async function importedFloorplans(): Promise<FloorplanEntry[]> {
  try {
    return (await get<FloorplanEntry[]>('list', store)) ?? [];
  } catch {
    return [];
  }
}
/**
 * 匯入資料集 JSON：[{ name, city?, community?, ping, bed, living?, bath?, scene }]。
 * 每筆的 scene 經 migrate＋驗證；不合法的略過並回報筆數。
 */
export async function importFloorplanDataset(json: string): Promise<{ added: number; skipped: number }> {
  const raw = JSON.parse(json) as unknown;
  const arr = Array.isArray(raw) ? raw : [];
  const ok: FloorplanEntry[] = [];
  let skipped = 0;
  arr.forEach((r: Record<string, unknown>, i) => {
    const v = validateScene(migrate(r.scene));
    const ping = Number(r.ping);
    if (!v.ok || !(ping > 0) || typeof r.name !== 'string') return void skipped++;
    ok.push({
      id: `imp-${Date.now().toString(36)}-${i}`,
      name: r.name,
      city: typeof r.city === 'string' ? r.city : undefined,
      community: typeof r.community === 'string' ? r.community : undefined,
      ping,
      bed: Number(r.bed) || 0,
      living: Number(r.living) || 1,
      bath: Number(r.bath) || 1,
      source: 'imported',
      scene: v.scene,
    });
  });
  await set('list', [...(await importedFloorplans()), ...ok], store);
  return { added: ok.length, skipped };
}
export async function clearImportedFloorplans() {
  await set('list', [], store);
}
