import { SEED_CATALOG, SEED_MATERIALS } from '@interiorai/catalog';
import type { Scene } from '@interiorai/scene-schema';

const KIND: [string, RegExp][] = [
  ['bathroom', /浴|廁|衛|bath|toilet|wc/i],
  ['kitchen', /廚|kitchen/i],
  ['bedroom', /臥|睡|bed/i],
  ['dining room', /餐|dining/i],
  ['living room', /客|廳|living|lounge/i],
];
const kindOf = (label?: string) => KIND.find(([, re]) => re.test(label ?? ''))?.[0] ?? 'room';

const matName = new Map(SEED_MATERIALS.map((m) => [m.id, m.nameEn ?? m.nameZh]));
const itemName = new Map(SEED_CATALOG.map((e) => [e.id, e.nameEn ?? e.nameZh]));

/**
 * Scene → prompt 用的空間類型與材質清單（05 §4：材質清單由 Scene Graph 產生）。
 * 只送名稱與材質，不含使用者個資、座標或原始平面圖（B6.4-4 最小化）。
 */
export function summarizeScene(scene: Scene) {
  const lvl = scene.levels[0]!;
  const kinds = [...new Set(lvl.rooms.map((r) => kindOf(r.label)))];
  const roomType = kinds.length ? kinds.join(', ') : 'room';
  const lines: string[] = [];
  for (const r of lvl.rooms) {
    const m = r.floorMaterialId ? matName.get(r.floorMaterialId) : undefined;
    if (m) lines.push(`- ${kindOf(r.label)} floor: ${m}`);
  }
  const walls = [...new Set(lvl.walls.map((w) => w.materialId).filter(Boolean))].map(
    (id) => matName.get(id!) ?? id,
  );
  if (walls.length) lines.push(`- walls: ${walls.join(', ')}`);
  const counts = new Map<string, number>();
  for (const o of lvl.objects) {
    const n = itemName.get(o.catalogId) ?? o.catalogId;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  if (counts.size)
    lines.push(`- furniture: ${[...counts].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ')}`);
  return { roomType, materialList: lines.join('\n') || '- (unspecified)' };
}
