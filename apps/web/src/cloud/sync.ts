import type { Scene } from '@interiorai/scene-schema';
import { ApiClientError, api } from './client';

interface Link {
  projectId: string;
  versionId: string | null;
}
const key = (localId: string) => `cloud:${localId}`;
const read = (localId: string): Link | null => {
  try {
    return JSON.parse(localStorage.getItem(key(localId)) ?? 'null') as Link | null;
  } catch {
    return null;
  }
};
const write = (localId: string, l: Link) => {
  try {
    localStorage.setItem(key(localId), JSON.stringify(l));
  } catch {
    /* 私密模式等：下次重新建立雲端專案 */
  }
};

/**
 * 把本機專案目前的 Scene 存成雲端版本（AI 渲染需要不可變版本，B6.1-5 provenance 的 sceneHash）。
 * 本機↔雲端對應存在 localStorage；雲端有較新版本（409）時，以目前本機內容接在最新版本之後
 * （渲染只需要「此刻畫面」的快照；完整的雲端同步與衝突三選項屬 P7 桌面/離線範圍）。
 */
export async function snapshotToCloud(
  localId: string,
  name: string,
  scene: Scene,
): Promise<{ projectId: string; versionId: string }> {
  let link = read(localId);
  if (link) {
    try {
      await api.get('/projects/{id}', { params: { id: link.projectId } });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 404) link = null;
      else throw e;
    }
  }
  if (!link) {
    const p = await api.post('/projects', { body: { name: name || 'Untitled' } });
    link = { projectId: p.id, versionId: null };
  }
  const save = (base: string | null) =>
    api.post('/projects/{id}/versions', {
      params: { id: link!.projectId },
      body: { baseVersionId: base, scene: scene as never, note: 'render snapshot' },
    });
  let v;
  try {
    v = await save(link.versionId);
  } catch (e) {
    if (!(e instanceof ApiClientError) || e.code !== 'VERSION_CONFLICT') throw e;
    const latest = (e.details as { latest: { id: string } | null }).latest;
    v = await save(latest?.id ?? null);
  }
  link = { projectId: link.projectId, versionId: v.id };
  write(localId, link);
  return { projectId: link.projectId, versionId: v.id };
}
