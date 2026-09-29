import { create } from 'zustand';
import type { AreaUnit, LengthUnit } from '@interiorai/editor-2d';

interface Prefs {
  lengthUnit: LengthUnit;
  areaUnit: AreaUnit;
  setLength(u: LengthUnit): void;
  setArea(u: AreaUnit): void;
}
const read = <T extends string>(k: string, fb: T): T => {
  try {
    return (localStorage.getItem(k) as T | null) ?? fb;
  } catch {
    return fb;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};
/** 使用者偏好（每位使用者本機；不進 Scene） */
export const usePrefs = create<Prefs>((set) => ({
  lengthUnit: read<LengthUnit>('lengthUnit', 'cm'),
  areaUnit: read<AreaUnit>('areaUnit', 'ping'),
  setLength: (lengthUnit) => (write('lengthUnit', lengthUnit), set({ lengthUnit })),
  setArea: (areaUnit) => (write('areaUnit', areaUnit), set({ areaUnit })),
}));
