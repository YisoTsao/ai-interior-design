import { create } from 'zustand';

/** 從資產詳情「以此材質放置」：下一次放置該品項時套用的主材質（FE-AST-05） */
export const usePlaceMaterial = create<{
  pending: { catalogId: string; slot: string; materialId: string } | null;
  set(p: { catalogId: string; slot: string; materialId: string } | null): void;
}>((set) => ({ pending: null, set: (pending) => set({ pending }) }));
