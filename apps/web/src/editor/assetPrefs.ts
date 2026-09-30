import { useSyncExternalStore } from 'react';

/** 資產庫的收藏與最近使用（FE-AST-03；本機偏好） */
const FAV = 'interiorai:favorites';
const RECENT = 'interiorai:recent';
const subs = new Set<() => void>();
const read = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]') as string[];
  } catch {
    return [];
  }
};
let state = { fav: read(FAV), recent: read(RECENT) };
const write = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
const emit = () => subs.forEach((f) => f());

export function toggleFavorite(id: string) {
  const fav = state.fav.includes(id) ? state.fav.filter((x) => x !== id) : [id, ...state.fav];
  state = { ...state, fav };
  write(FAV, fav);
  emit();
}
export function recordRecent(id: string) {
  const recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 24);
  state = { ...state, recent };
  write(RECENT, recent);
  emit();
}
export function useAssetPrefs() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}
