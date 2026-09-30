import { create } from 'zustand';
import type { LuxResult } from '../ai/illuminance';

/** 最近一次照度計算結果（編輯器計算、屬性面板顯示） */
export const useLuxResult = create<{ result: LuxResult | null; set(r: LuxResult | null): void }>((set) => ({
  result: null,
  set: (result) => set({ result }),
}));
