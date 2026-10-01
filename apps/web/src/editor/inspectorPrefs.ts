import { create } from 'zustand';

/**
 * 屬性面板搜尋與釘選（FE-PROP-07）：query 篩選分節（標題或內容含關鍵字）；
 * pins＝釘選的分節標題（本機保存），一律展開並在面板頂端提供跳轉。
 */
const KEY = 'inspectorPins';
const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
export const useInspectorPrefs = create<{
  query: string;
  pins: string[];
  setQuery(q: string): void;
  togglePin(title: string): void;
}>((set, get) => ({
  query: '',
  pins: load(),
  setQuery: (query) => set({ query }),
  togglePin: (title) => {
    const pins = get().pins.includes(title) ? get().pins.filter((x) => x !== title) : [...get().pins, title];
    try {
      localStorage.setItem(KEY, JSON.stringify(pins));
    } catch {
      /* 私密模式 */
    }
    set({ pins });
  },
}));
