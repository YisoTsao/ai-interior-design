/**
 * 自訂快捷鍵（FE-UX-03）：單鍵動作可改綁；存在本機。事件處理時把自訂鍵轉回預設鍵，被改綁掉的預設鍵停用。
 */
export const REBINDABLE: { key: string; label: string }[] = [
  { key: 'v', label: 'tools.select' },
  { key: 'w', label: 'tools.wall' },
  { key: 'p', label: 'tools.polygon' },
  { key: 'c', label: 'tools.arc' },
  { key: 'd', label: 'tools.door' },
  { key: 'n', label: 'tools.window' },
  { key: 'm', label: 'tools.measure' },
  { key: 'k', label: 'tools.dimension' },
  { key: 't', label: 'tools.text' },
  { key: 'e', label: 'shortcuts.rotate' },
  { key: 'l', label: 'shortcuts.lock' },
  { key: 'h', label: 'shortcuts.hide' },
  { key: 'f', label: 'shortcuts.frame' },
];
const KEY = 'keymap';
export function loadKeymap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
export function saveKeymap(m: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 私密模式 */
  }
}
/** 自訂鍵 → 預設鍵；回傳 null＝此鍵已被改綁停用 */
export function translateKey(k: string, m: Record<string, string> = loadKeymap()): string | null {
  for (const [def, custom] of Object.entries(m)) if (custom === k && def !== k) return def;
  if (m[k] && m[k] !== k) return null;
  return k;
}
