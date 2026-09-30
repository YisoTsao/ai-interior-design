import { create } from 'zustand';
import { getUnderlay, setUnderlay, type UnderlayRecord } from '../media';

/** 目前專案的描圖底圖（FE-PLAN-11）：Plan2D 與設定面板共用；變更即寫回 IndexedDB */
interface UnderlayState {
  projectId: string | null;
  rec: UnderlayRecord | null;
  load(projectId: string): Promise<void>;
  update(p: Partial<UnderlayRecord>): void;
  replace(rec: UnderlayRecord | null): void;
}
export const useUnderlay = create<UnderlayState>((set, get) => ({
  projectId: null,
  rec: null,
  async load(projectId) {
    set({ projectId, rec: null });
    const rec = (await getUnderlay(projectId)) ?? null;
    if (get().projectId === projectId) set({ rec });
  },
  update(p) {
    const { rec, projectId } = get();
    if (!rec || !projectId) return;
    const next = { ...rec, ...p };
    set({ rec: next });
    void setUnderlay(projectId, next);
  },
  replace(rec) {
    const { projectId } = get();
    set({ rec });
    if (projectId) void setUnderlay(projectId, rec);
  },
}));

/** 讀圖檔 → dataURL，並給一個預設寬度（10 m）與位置（原點） */
export async function underlayFromFile(file: File): Promise<UnderlayRecord> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  return { src, x: 0, z: 0, widthMm: 10_000, rotationDeg: 0, opacity: 0.5, visible: true };
}
