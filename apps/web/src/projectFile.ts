import { loadProject, saveProject, createEditorStore } from '@interiorai/app-state';
import { migrate, validateScene, type Scene } from '@interiorai/scene-schema';
import { importUserAsset, readUserAssets, USER_TAG } from './userAssets';
import { catalog } from './catalogData';

/**
 * 專案檔（FE-PRJ-06）：`.interiorai` = gzip 壓縮的 JSON（Scene＋專案中用到的自行上傳模型，base64）。
 * 單一檔案即可在另一台電腦開啟；拖放到專案列表即匯入。
 */
export const PROJECT_EXT = '.interiorai';
interface ProjectFile {
  format: 'interiorai-project';
  version: 1;
  name: string;
  exportedAt: string;
  scene: unknown;
  assets: { entry: unknown; glb: string }[];
}

const toB64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export async function exportProjectFile(scene: Scene, name: string): Promise<Blob> {
  const used = new Set(scene.levels.flatMap((l) => l.objects.map((o) => o.catalogId)));
  const userIds = [...used].filter((id) => catalog.get(id)?.tags.includes(USER_TAG));
  const assets = (await readUserAssets(userIds)).map((a) => ({ entry: a.entry, glb: toB64(a.bytes) }));
  const file: ProjectFile = {
    format: 'interiorai-project',
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    scene,
    assets,
  };
  const stream = new Blob([JSON.stringify(file)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function exportProjectById(id: string): Promise<{ blob: Blob; name: string } | null> {
  const rec = await loadProject(id);
  return rec ? { blob: await exportProjectFile(rec.scene, rec.name), name: rec.name } : null;
}

/** 匯入：驗證場景 → 匯入模型（保留 id）→ 建立新專案；回傳新專案 id */
export async function importProjectFile(file: Blob): Promise<string> {
  let text: string;
  try {
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } catch {
    text = await file.text(); // 也接受未壓縮的 JSON
  }
  const obj = JSON.parse(text) as Partial<ProjectFile>;
  if (obj.format !== 'interiorai-project') throw new Error('NOT_PROJECT_FILE');
  const v = validateScene(migrate(obj.scene));
  if (!v.ok) throw new Error(v.issues[0]?.message ?? 'INVALID_SCENE');
  for (const a of obj.assets ?? []) await importUserAsset(a.entry, fromB64(a.glb));
  const id = createEditorStore().getState().projectId;
  await saveProject({ id, name: obj.name ?? 'Imported', scene: v.scene });
  return id;
}
