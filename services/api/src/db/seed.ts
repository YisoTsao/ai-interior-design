import { sql } from 'drizzle-orm';
import { SEED_CATALOG, SEED_MATERIALS } from '@interiorai/catalog';
import type { Db } from './db.js';
import { catalogAssets, materials } from './schema.js';

/**
 * 以前端種子目錄（packages/catalog）填入 catalog_assets / materials（以 slug upsert，可重複執行）。
 * 參數化模組沒有模型檔：model_key 為空、parametric 存 {type, params}。
 */
export async function seedCatalog(db: Db) {
  for (const e of SEED_CATALOG) {
    const parametric = e.model.kind === 'parametric' ? (e.model as unknown as Record<string, unknown>) : null;
    await db.orm
      .insert(catalogAssets)
      .values({
        slug: e.slug,
        nameZh: e.nameZh,
        nameEn: e.nameEn,
        category: e.category,
        tags: e.tags,
        styleTags: e.styleTags,
        dimsMm: e.dimsMm,
        anchor: e.anchor,
        materialSlots: e.materialSlots,
        parametric,
        license: (e.license ?? { type: 'unknown', source: 'unknown' }) as Record<string, unknown>,
        status: e.status,
      })
      .onConflictDoUpdate({
        target: catalogAssets.slug,
        set: { nameZh: e.nameZh, dimsMm: e.dimsMm, status: e.status, parametric, tags: e.tags },
      });
  }
  for (const m of SEED_MATERIALS) {
    await db.orm
      .insert(materials)
      .values({
        slug: m.id,
        nameZh: m.nameZh,
        category: m.category,
        maps: { procedural: { color: m.color, pattern: m.pattern, roughness: m.roughness } },
        realSizeMm: m.realSizeMm,
        license: m.license as Record<string, unknown>,
        status: 'published',
      })
      .onConflictDoUpdate({ target: materials.slug, set: { nameZh: m.nameZh, realSizeMm: m.realSizeMm } });
  }
  const [{ n }] = (await db.orm.execute<{ n: number }>(sql`select count(*)::int as n from catalog_assets`))
    .rows as [{ n: number }];
  return n;
}
