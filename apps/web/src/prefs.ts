import { create } from 'zustand';
import type { AreaUnit, LengthUnit } from '@interiorai/editor-2d';
import {
  DEFAULT_GRAPHICS,
  type GraphicsSettings,
  type LightingMode,
  type ViewStyle,
} from '@interiorai/viewer-3d';

interface Prefs {
  lengthUnit: LengthUnit;
  areaUnit: AreaUnit;
  setLength(u: LengthUnit): void;
  setArea(u: AreaUnit): void;
  viewStyle: ViewStyle;
  setViewStyle(s: ViewStyle): void;
  lighting: LightingMode;
  setLighting(l: LightingMode): void;
  /** 畫質（本機偏好） */
  graphics: GraphicsSettings;
  setGraphics(p: Partial<GraphicsSettings>): void;
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
const readGraphics = (): GraphicsSettings => {
  try {
    const raw = localStorage.getItem('graphics');
    return raw
      ? { ...DEFAULT_GRAPHICS, ...(JSON.parse(raw) as Partial<GraphicsSettings>) }
      : DEFAULT_GRAPHICS;
  } catch {
    return DEFAULT_GRAPHICS;
  }
};
/** 使用者偏好（每位使用者本機；不進 Scene） */
export const usePrefs = create<Prefs>((set) => ({
  lengthUnit: read<LengthUnit>('lengthUnit', 'cm'),
  areaUnit: read<AreaUnit>('areaUnit', 'ping'),
  setLength: (lengthUnit) => (write('lengthUnit', lengthUnit), set({ lengthUnit })),
  setArea: (areaUnit) => (write('areaUnit', areaUnit), set({ areaUnit })),
  viewStyle: read<ViewStyle>('viewStyle', 'dollhouse'),
  setViewStyle: (viewStyle) => (write('viewStyle', viewStyle), set({ viewStyle })),
  // 預設夜間氛圍（images1：燈具為主要光源）
  lighting: read<LightingMode>('lighting', 'night'),
  setLighting: (lighting) => (write('lighting', lighting), set({ lighting })),
  graphics: readGraphics(),
  setGraphics: (p) =>
    set((st) => {
      const graphics = { ...st.graphics, ...p };
      write('graphics', JSON.stringify(graphics));
      return { graphics };
    }),
}));
