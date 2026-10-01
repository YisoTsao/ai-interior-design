import { useEffect, useRef, useState } from 'react';
import { DEFAULTS, type EditorStore } from '@interiorai/app-state';
import type { Catalog } from '@interiorai/catalog';
import type { Scene } from '@interiorai/scene-schema';

/**
 * 成就／進度提示（FE-UX-10）：完成設計流程的里程碑（畫牆 → 封閉房間 → 佈置 → 換材質 → 看 3D → 出圖 → 分享）。
 * 依場景狀態判斷者為純函式（evaluate）；出圖、分享等由事件觸發（emitAchievement）。解鎖紀錄存在本機。
 */
export const ACHIEVEMENTS = [
  'firstWall',
  'firstRoom',
  'furnished',
  'material',
  'lighting',
  'view3d',
  'image',
  'share',
] as const;
export type Achievement = (typeof ACHIEVEMENTS)[number];

export function evaluate(scene: Scene, view: '2d' | '3d', catalog?: Catalog): Set<Achievement> {
  const out = new Set<Achievement>();
  const lv = scene.levels;
  if (lv.some((l) => l.walls.length > 0)) out.add('firstWall');
  if (lv.some((l) => l.rooms.length > 0)) out.add('firstRoom');
  if (lv.some((l) => l.objects.length >= 5)) out.add('furnished');
  if (
    lv.some(
      (l) =>
        l.walls.some(
          (w) => (w.materialId && w.materialId !== DEFAULTS.wallMaterialId) || w.appearance?.color,
        ) || l.rooms.some((r) => r.floorMaterialId && r.floorMaterialId !== DEFAULTS.floorMaterialId),
    )
  )
    out.add('material');
  if (
    lv.some((l) => l.objects.some((o) => o.light || catalog?.get(o.catalogId)?.light)) ||
    (scene.lightScenes?.length ?? 0) > 0
  )
    out.add('lighting');
  if (view === '3d') out.add('view3d');
  return out;
}

const KEY = 'achievements';
export function unlocked(): Set<Achievement> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as Achievement[]);
  } catch {
    return new Set();
  }
}
function save(s: Set<Achievement>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* 私密模式 */
  }
}
/** 事件型成就（出圖、分享） */
export function emitAchievement(a: Achievement) {
  window.dispatchEvent(new CustomEvent<Achievement>('interiorai:achievement', { detail: a }));
}

/** 監聽場景與事件；新解鎖時呼叫 onUnlock；回傳目前已解鎖集合 */
export function useAchievements(
  store: EditorStore,
  catalog: Catalog,
  onUnlock: (a: Achievement) => void,
): Set<Achievement> {
  const [done, setDone] = useState(unlocked);
  const cb = useRef(onUnlock);
  cb.current = onUnlock;
  useEffect(() => {
    // 第一次檢查（開啟專案時）只記錄、不提示，避免一開範例專案就連跳多則通知
    let quiet = true;
    const add = (list: Iterable<Achievement>) => {
      const cur = unlocked();
      const fresh = [...list].filter((a) => !cur.has(a));
      if (!fresh.length) return;
      fresh.forEach((a) => cur.add(a));
      save(cur);
      setDone(new Set(cur));
      if (!quiet) fresh.forEach((a) => cb.current(a));
    };
    const check = () => {
      const s = store.getState();
      add(evaluate(s.scene, s.view, catalog));
    };
    check();
    quiet = false;
    const unsub = store.subscribe((s, p) => {
      if (s.scene !== p.scene || s.view !== p.view) check();
    });
    const on = (e: Event) => add([(e as CustomEvent<Achievement>).detail]);
    window.addEventListener('interiorai:achievement', on);
    return () => {
      unsub();
      window.removeEventListener('interiorai:achievement', on);
    };
  }, [store, catalog]);
  return done;
}
