import { createStore as createIdbStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import { migrate, validateScene, type Scene } from '@interiorai/scene-schema';
import type { EditorStore } from './store.js';

export interface ProjectRecord {
  id: string;
  name: string;
  scene: Scene;
  updatedAt: string;
}
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  wallCount: number;
  objectCount: number;
}

export const AUTOSAVE_DEBOUNCE_MS = 1500;

let db: UseStore | null = null;
const store = () => (db ??= createIdbStore('interiorai', 'projects'));

/** 寫入前驗證（B2：讀寫都必須通過驗證） */
export async function saveProject(rec: Omit<ProjectRecord, 'updatedAt'>): Promise<ProjectRecord> {
  const v = validateScene(rec.scene);
  if (!v.ok) throw new Error(`場景驗證失敗：${v.issues[0]?.message}`);
  const full = { ...rec, updatedAt: new Date().toISOString() };
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
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const deleteProject = (id: string) => del(id, store());

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
