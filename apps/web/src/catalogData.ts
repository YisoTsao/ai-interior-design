import { useSyncExternalStore } from 'react';
import { createCatalog, SEED_CATALOG, SEED_MATERIALS } from '@interiorai/catalog';

/** P2：目錄內建於前端；使用者上傳的 3D 模型於執行期加入（userAssets.ts） */
export const catalog = createCatalog(SEED_CATALOG);
export const materials = SEED_MATERIALS;

/** 目錄內容版本（上傳／刪除模型時遞增），讓畫面重新整理 */
export function useCatalogVersion(): number {
  return useSyncExternalStore(catalog.subscribe, catalog.version, catalog.version);
}
