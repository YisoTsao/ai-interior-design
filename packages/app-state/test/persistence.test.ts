import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '@interiorai/scene-schema';
import {
  activeLevel,
  addRectRoom,
  createEditorStore,
  deleteProject,
  listProjects,
  loadProject,
  purgeTrash,
  restoreProject,
  saveProject,
  setProjectTags,
  trashProject,
  startAutosave,
} from '../src/index.js';

describe('persistence（S2.10）', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('autosave debounce 1.5s 後寫入，可列出與重新載入（一致）', async () => {
    const store = createEditorStore({ projectId: 'p_auto', projectName: '自動儲存' });
    const auto = startAutosave(store);
    store.getState().exec(addRectRoom(store.getState().levelId, [0, 0], [3000, 3000]));
    store.getState().exec(addRectRoom(store.getState().levelId, [5000, 0], [8000, 3000]));
    expect(store.getState().saveStatus).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1499);
    expect(await loadProject('p_auto')).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    await auto.flush();
    expect(store.getState().saveStatus).toBe('saved');
    const rec = await loadProject('p_auto');
    expect(rec?.scene).toEqual(store.getState().scene);
    const list = await listProjects();
    expect(list.find((p) => p.id === 'p_auto')).toMatchObject({ name: '自動儲存', wallCount: 8 });
    auto.dispose();
  });

  it('flush 立即寫入；非 dirty 的變動（例如選取）不觸發', async () => {
    const store = createEditorStore({ projectId: 'p_flush', projectName: 'f' });
    const auto = startAutosave(store);
    store.getState().select(['x']);
    await auto.flush();
    expect(await loadProject('p_flush')).toBeNull();
    store.getState().rename('改名');
    await auto.flush();
    expect((await loadProject('p_flush'))?.name).toBe('改名');
    auto.dispose();
  });

  it('寫入不合法場景 → 錯誤狀態與提示', async () => {
    const store = createEditorStore({ projectId: 'p_bad', projectName: 'bad' });
    const auto = startAutosave(store);
    store.getState().exec({
      id: 'bad',
      label: 'bad',
      do: (d) => {
        d.levels[0]!.height = 10;
      },
    });
    await auto.flush();
    expect(store.getState().saveStatus).toBe('error');
    expect(store.getState().notices.at(-1)?.kind).toBe('error');
    auto.dispose();
  });

  it('讀取時 migrate + 驗證；損毀資料丟錯；刪除', async () => {
    const store = createEditorStore();
    const scene = store.getState().scene;
    const { schemaVersion: _v, units: _u, ...v0 } = scene;
    await saveProject({ id: 'p_v0', name: 'v0', scene });
    // 直接覆寫成 v0 格式模擬舊資料
    const { set, createStore } = await import('idb-keyval');
    const raw = createStore('interiorai', 'projects');
    await set('p_v0', { id: 'p_v0', name: 'v0', scene: v0, updatedAt: '2020-01-01' }, raw);
    expect((await loadProject('p_v0'))?.scene.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    await set(
      'p_broken',
      { id: 'p_broken', name: 'x', scene: { ...scene, levels: [] }, updatedAt: '2020' },
      raw,
    );
    await expect(loadProject('p_broken')).rejects.toThrow(/無法讀取/);
    await deleteProject('p_v0');
    expect(await loadProject('p_v0')).toBeNull();
    await expect(
      saveProject({ id: 'x', name: 'x', scene: { ...scene, units: 'm' as 'mm' } }),
    ).rejects.toThrow(/驗證失敗/);
    expect(activeLevel(store.getState()).walls).toEqual([]);
  });

  it('load() 重設歷史與選取', () => {
    const a = createEditorStore();
    a.getState().exec(addRectRoom(a.getState().levelId, [0, 0], [3000, 3000]));
    const b = createEditorStore();
    b.getState().select(['x']);
    b.getState().load({ projectId: 'p1', projectName: 'n', scene: a.getState().scene });
    expect(b.getState()).toMatchObject({ projectId: 'p1', selection: [], saveStatus: 'saved' });
    expect(b.getState().history.past).toEqual([]);
  });

  it('標籤與垃圾桶：自動存檔保留標籤；可還原；超過 30 天永久刪除', async () => {
    const st = createEditorStore({ projectId: 'p_tags', projectName: 't' });
    await saveProject({ id: 'p_tags', name: 't', scene: st.getState().scene });
    await setProjectTags('p_tags', ['客戶 A', ' 客戶 A ', '北歐']);
    await saveProject({ id: 'p_tags', name: 't2', scene: st.getState().scene });
    let row = (await listProjects()).find((p) => p.id === 'p_tags')!;
    expect(row.tags).toEqual(['客戶 A', '北歐']);
    await trashProject('p_tags', new Date('2026-01-01'));
    row = (await listProjects()).find((p) => p.id === 'p_tags')!;
    expect(row.deletedAt).toBe('2026-01-01T00:00:00.000Z');
    await restoreProject('p_tags');
    expect((await listProjects()).find((p) => p.id === 'p_tags')!.deletedAt).toBeUndefined();
    await trashProject('p_tags', new Date('2026-01-01'));
    expect(await purgeTrash(new Date('2026-01-20'))).toEqual([]);
    expect(await purgeTrash(new Date('2026-02-05'))).toEqual(['p_tags']);
    expect(await loadProject('p_tags')).toBeNull();
  });
});
