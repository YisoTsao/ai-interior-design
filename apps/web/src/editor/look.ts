import type { Appearance, LightOverride } from '@interiorai/scene-schema';

/** 合併覆寫欄位：undefined 表示恢復預設（刪除鍵）；全部恢復時回傳 undefined（不在 Scene 留空物件） */
export function mergeLook<T extends Appearance | LightOverride>(
  cur: T | undefined,
  patch: Partial<T>,
): T | undefined {
  const next: Record<string, unknown> = { ...(cur ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as T) : undefined;
}
