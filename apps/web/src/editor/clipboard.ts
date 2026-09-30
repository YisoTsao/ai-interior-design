import type { Clip } from '@interiorai/app-state';

/** 剪貼簿（FE-PLAN-08）：記憶體＋localStorage，可跨專案、跨樓層貼上 */
const KEY = 'interiorai:clipboard';
let mem: Clip | null = null;

export function setClip(c: Clip) {
  mem = c;
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 容量不足或私密模式：只保留記憶體 */
  }
}
export function getClip(): Clip | null {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Clip) : null;
  } catch {
    return null;
  }
}
