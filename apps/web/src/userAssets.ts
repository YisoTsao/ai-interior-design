import { createStore, del, get, set } from 'idb-keyval';
import { CatalogEntrySchema, type CatalogEntry } from '@interiorai/catalog';
import { parseModel, setModelResolver, type LoadedModel } from '@interiorai/viewer-3d';
import { catalog } from './catalogData';

/**
 * 使用者上傳的 3D 模型（ADR-023）：模型位元組與目錄項存在瀏覽器 IndexedDB（本機，不上雲），
 * 啟動時加入資產目錄；viewer 透過 model resolver 以 `user-asset:<id>` 讀取位元組。
 * 雲端資產上傳走 P3 的 Upload API（尚未接上前端）。
 */
const store = createStore('interiorai-assets', 'models');
const LIST_KEY = 'entries';
const PREFIX = 'user-asset:';

/** 上限：避免把 IndexedDB 塞爆、也避免瀏覽器卡住（〔假設〕） */
export const UPLOAD_LIMITS = { maxBytes: 50 * 1024 * 1024, maxTriangles: 500_000 } as const;
export const USER_TAG = 'user-upload';

export type UploadUnit = 'm' | 'cm' | 'mm' | 'in';
export const UNIT_TO_MM: Record<UploadUnit, number> = { m: 1000, cm: 10, mm: 1, in: 25.4 };

let ready: Promise<void> | null = null;

/** 啟動：註冊 resolver 並把已上傳的模型加入目錄（重複呼叫只執行一次） */
export function initUserAssets(): Promise<void> {
  setModelResolver(async (url) => {
    if (url.startsWith(PREFIX)) {
      const buf = await get<ArrayBuffer>(url, store);
      if (!buf) throw new Error('MODEL_MISSING');
      return buf;
    }
    return (await fetch(url)).arrayBuffer();
  });
  ready ??= (async () => {
    try {
      const list = (await get<unknown[]>(LIST_KEY, store)) ?? [];
      for (const raw of list) {
        const r = CatalogEntrySchema.safeParse(raw);
        if (r.success) catalog.add(r.data);
      }
    } catch {
      /* 私密模式等無法使用 IndexedDB：只是沒有已上傳的模型 */
    }
  })();
  return ready;
}

export interface UploadCheck {
  model: LoadedModel;
  bytes: ArrayBuffer;
  warnings: ('TRIANGLES' | 'SIZE_ODD')[];
}

/** 讀檔並解析（上傳前預覽）：只接受 GLB 或自含式 glTF（外部 .bin/貼圖無法隨單一檔案帶入） */
export async function inspectModelFile(file: File): Promise<UploadCheck> {
  if (!/\.(glb|gltf)$/i.test(file.name)) throw new Error('UPLOAD_FORMAT');
  if (file.size > UPLOAD_LIMITS.maxBytes) throw new Error('UPLOAD_TOO_LARGE');
  const bytes = await file.arrayBuffer();
  let model: LoadedModel;
  try {
    model = await parseModel(bytes);
  } catch {
    throw new Error('UPLOAD_PARSE');
  }
  const warnings: UploadCheck['warnings'] = [];
  if (model.triangles > UPLOAD_LIMITS.maxTriangles) warnings.push('TRIANGLES');
  const maxM = Math.max(model.size.x, model.size.y, model.size.z);
  if (maxM > 20 || maxM < 0.02) warnings.push('SIZE_ODD');
  return { model, bytes, warnings };
}

export async function saveUserAsset(o: {
  name: string;
  category: CatalogEntry['category'];
  anchor: CatalogEntry['anchor'];
  dimsMm: { w: number; d: number; h: number };
  elevationMm?: number;
  bytes: ArrayBuffer;
}): Promise<CatalogEntry> {
  const id = `ua_${crypto.randomUUID().replace(/-/g, '')}`;
  const url = `${PREFIX}${id}`;
  const entry: CatalogEntry = CatalogEntrySchema.parse({
    id,
    slug: id.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    nameZh: o.name,
    nameEn: o.name,
    category: o.category,
    tags: [USER_TAG, o.name],
    styleTags: [],
    dimsMm: {
      w: Math.max(1, Math.round(o.dimsMm.w)),
      d: Math.max(1, Math.round(o.dimsMm.d)),
      h: Math.max(1, Math.round(o.dimsMm.h)),
    },
    anchor: o.anchor,
    ...(o.elevationMm ? { elevationMm: Math.round(o.elevationMm) } : {}),
    model: { kind: 'glb', url },
    materialSlots: [],
    // 使用者自行聲明有權使用；僅限本機設計與渲染，不進公開資產庫（B5）
    license: { type: 'user-provided', source: '使用者上傳', allowedUse: ['render'] },
    status: 'published',
  });
  await set(url, o.bytes, store);
  const list = ((await get<CatalogEntry[]>(LIST_KEY, store)) ?? []).filter((e) => e.id !== id);
  await set(LIST_KEY, [...list, entry], store);
  catalog.add(entry);
  return entry;
}

export async function deleteUserAsset(id: string): Promise<void> {
  const list = (await get<CatalogEntry[]>(LIST_KEY, store)) ?? [];
  const e = list.find((x) => x.id === id);
  await set(
    LIST_KEY,
    list.filter((x) => x.id !== id),
    store,
  );
  if (e?.model.kind === 'glb') await del(e.model.url, store);
  catalog.remove(id);
}

export const isUserAsset = (e: CatalogEntry | undefined) => !!e?.tags.includes(USER_TAG);

/** 列出已上傳的模型（管理頁用） */
export async function listUserAssets(): Promise<CatalogEntry[]> {
  return (await get<CatalogEntry[]>(LIST_KEY, store)) ?? [];
}

/** 修改名稱、分類、尺寸、放置方式（FE-AST-10）；目錄即時更新 */
export async function updateUserAsset(
  id: string,
  patch: Partial<Pick<CatalogEntry, 'nameZh' | 'category' | 'anchor' | 'dimsMm' | 'elevationMm'>>,
): Promise<CatalogEntry | null> {
  const list = await listUserAssets();
  const cur = list.find((x) => x.id === id);
  if (!cur) return null;
  const next = CatalogEntrySchema.parse({
    ...cur,
    ...patch,
    ...(patch.nameZh ? { nameEn: patch.nameZh, tags: [USER_TAG, patch.nameZh] } : {}),
  });
  await set(
    LIST_KEY,
    list.map((x) => (x.id === id ? next : x)),
    store,
  );
  catalog.remove(id);
  catalog.add(next);
  return next;
}

/** 替換模型檔（保留 id，場景中的引用不變） */
export async function replaceUserAssetFile(id: string, bytes: ArrayBuffer): Promise<void> {
  const e = (await listUserAssets()).find((x) => x.id === id);
  if (e?.model.kind !== 'glb') throw new Error('MODEL_MISSING');
  await set(e.model.url, bytes, store);
  // 重新加入目錄 → 版本遞增 → viewer 重新載入
  catalog.remove(id);
  catalog.add(e);
}

/** 匯出（專案檔打包用）：目錄項＋模型位元組 */
export async function readUserAssets(
  ids: readonly string[],
): Promise<{ entry: CatalogEntry; bytes: ArrayBuffer }[]> {
  const list = await listUserAssets();
  const out: { entry: CatalogEntry; bytes: ArrayBuffer }[] = [];
  for (const e of list)
    if (ids.includes(e.id) && e.model.kind === 'glb') {
      const bytes = await get<ArrayBuffer>(e.model.url, store);
      if (bytes) out.push({ entry: e, bytes });
    }
  return out;
}

/** 匯入（專案檔）：保留原 id；已存在則略過 */
export async function importUserAsset(raw: unknown, bytes: ArrayBuffer): Promise<boolean> {
  const r = CatalogEntrySchema.safeParse(raw);
  if (!r.success || r.data.model.kind !== 'glb' || !r.data.model.url.startsWith(PREFIX)) return false;
  const list = await listUserAssets();
  if (list.some((x) => x.id === r.data.id)) return false;
  await set(r.data.model.url, bytes, store);
  await set(LIST_KEY, [...list, r.data], store);
  catalog.add(r.data);
  return true;
}
