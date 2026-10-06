import { detectRooms } from '@interiorai/core-geometry';
import { createStore as createIdbStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import { migrate, validateScene, type Scene } from '@interiorai/scene-schema';
import type { EditorStore } from './store.js';

export interface ProjectRecord {
  id: string;
  name: string;
  scene: Scene;
  updatedAt: string;
  /** 標籤（FE-PRJ-02；可當資料夾用） */
  tags?: string[];
  /** 移到垃圾桶的時間；30 天後永久刪除 */
  deletedAt?: string;
}
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  wallCount: number;
  objectCount: number;
  /** 房間數（所有樓層） */
  roomCount: number;
  /** 室內淨面積 m²（所有樓層、偵測到的房間） */
  areaM2: number;
  levelCount: number;
  tags: string[];
  deletedAt?: string;
}
/** 垃圾桶保留天數 */
export const TRASH_DAYS = 30;

export const AUTOSAVE_DEBOUNCE_MS = 1500;

let db: UseStore | null = null;
const store = () => (db ??= createIdbStore('interiorai', 'projects'));

/** 寫入前驗證（B2：讀寫都必須通過驗證） */
export async function saveProject(rec: Omit<ProjectRecord, 'updatedAt'>): Promise<ProjectRecord> {
  const v = validateScene(rec.scene);
  if (!v.ok) throw new Error(`場景驗證失敗：${v.issues[0]?.message}`);
  // 自動存檔只帶 id/name/scene：保留既有的標籤與垃圾桶狀態
  const prev = await get<ProjectRecord>(rec.id, store());
  const full: ProjectRecord = {
    ...(prev?.tags ? { tags: prev.tags } : {}),
    ...(prev?.deletedAt ? { deletedAt: prev.deletedAt } : {}),
    ...rec,
    updatedAt: new Date().toISOString(),
  };
  await set(rec.id, full, store());
  return full;
}

/** 讀取時先 migrate 再驗證；不合法回 null（呼叫端顯示「資料損毀」錯誤） */
export async function loadProject(id: string): Promise<ProjectRecord | null> {
  const raw = await get<ProjectRecord>(id, store());
  if (!raw) return null;
  const v = validateScene(migrate(raw.scene));
  if (!v.ok) throw new Error(`專案資料無法讀取：${v.issues[0]?.message}`);
  return { ...raw, scene: v.scene };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await entries<string, ProjectRecord>(store());
  return all
    .map(([, r]) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updatedAt,
      wallCount: r.scene.levels.reduce((s, l) => s + l.walls.length, 0),
      objectCount: r.scene.levels.reduce((s, l) => s + l.objects.length, 0),
      roomCount: r.scene.levels.reduce((s, l) => s + l.rooms.length, 0),
      areaM2:
        Math.round(
          r.scene.levels.reduce((s, l) => s + detectRooms(l).rooms.reduce((a, x) => a + x.netArea, 0), 0) /
            1e4,
        ) / 100,
      levelCount: r.scene.levels.length,
      tags: r.tags ?? [],
      ...(r.deletedAt ? { deletedAt: r.deletedAt } : {}),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const deleteProject = (id: string) => del(id, store());

/** 只改中繼資料（不動 updatedAt，避免排序跳動） */
async function patchRecord(id: string, f: (r: ProjectRecord) => ProjectRecord) {
  const r = await get<ProjectRecord>(id, store());
  if (r) await set(id, f(r), store());
}
export const setProjectTags = (id: string, tags: string[]) =>
  patchRecord(id, (r) => ({ ...r, tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))] }));
export const trashProject = (id: string, now = new Date()) =>
  patchRecord(id, (r) => ({ ...r, deletedAt: now.toISOString() }));
export const restoreProject = (id: string) => patchRecord(id, ({ deletedAt: _d, ...r }) => r);
/** 永久刪除超過 TRASH_DAYS 的垃圾桶項目；回傳刪除的 id */
export async function purgeTrash(now = new Date()): Promise<string[]> {
  const all = await entries<string, ProjectRecord>(store());
  const limit = now.getTime() - TRASH_DAYS * 86_400_000;
  const gone = all.filter(([, r]) => r.deletedAt && Date.parse(r.deletedAt) < limit).map(([k]) => k);
  await Promise.all(gone.map((k) => del(k, store())));
  return gone;
}

/**
 * 自動儲存（S2.10）：scene/名稱變動 debounce 1.5s → IndexedDB。
 * 回傳 { flush, dispose }；flush 立即寫入（離開頁面時用）。
 */
export function startAutosave(editor: EditorStore, debounceMs = AUTOSAVE_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> = Promise.resolve();
  const write = async () => {
    timer = null;
    const s = editor.getState();
    s.setSaveStatus('saving');
    try {
      await saveProject({ id: s.projectId, name: s.projectName, scene: s.scene });
      if (editor.getState().saveStatus === 'saving') editor.getState().setSaveStatus('saved');
    } catch (e) {
      editor.getState().setSaveStatus('error');
      editor.getState().notify('error', e instanceof Error ? e.message : String(e));
    }
  };
  const unsub = editor.subscribe((s, prev) => {
    if (s.scene === prev.scene && s.projectName === prev.projectName) return;
    if (s.saveStatus !== 'dirty') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (pending = write()), debounceMs);
  });
  return {
    async flush() {
      if (timer) {
        clearTimeout(timer);
        pending = write();
      }
      await pending;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      unsub();
    },
  };
}
