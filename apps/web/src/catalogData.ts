import { createCatalog, SEED_CATALOG, SEED_MATERIALS } from '@interiorai/catalog';

/** P2：目錄內建於前端；P3 起改由 Assets API 提供 */
export const catalog = createCatalog(SEED_CATALOG);
export const materials = SEED_MATERIALS;
