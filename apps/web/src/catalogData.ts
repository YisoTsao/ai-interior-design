import { useMemo, useSyncExternalStore } from 'react';
import {
  createCatalog,
  GENERATED_MATERIALS,
  SEED_CATALOG,
  SEED_MATERIALS,
  type Material,
} from '@interiorai/catalog';

/** P2：目錄內建於前端；使用者上傳的 3D 模型於執行期加入（userAssets.ts） */
export const catalog = createCatalog(SEED_CATALOG);
/**
 * 種子材質＋程序化擴充材質庫（FE-FIN-07）＋使用者自訂材質（FE-FIN-06，執行期加入）。
 * 陣列本身會被就地更新；需要重新整理的畫面用 useMaterials()（每次變更回傳新陣列）。
 */
export const materials: Material[] = [...SEED_MATERIALS, ...GENERATED_MATERIALS];

let matVersion = 0;
const subs = new Set<() => void>();
const bump = () => {
  matVersion++;
  subs.forEach((f) => f());
};
export function setUserMaterials(list: readonly Material[]) {
  const builtIn = materials.filter((m) => !m.id.startsWith('um_'));
  materials.length = 0;
  materials.push(...builtIn, ...list);
  bump();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export function useMaterials(): readonly Material[] {
  const v = useSyncExternalStore(
    subscribe,
    () => matVersion,
    () => matVersion,
  );
  // v 變更時產生新陣列（materials 為就地更新的模組變數）
  return useMemo(() => [...materials], [v]);
}

/** 目錄內容版本（上傳／刪除模型時遞增），讓畫面重新整理 */
export function useCatalogVersion(): number {
  return useSyncExternalStore(catalog.subscribe, catalog.version, catalog.version);
}
