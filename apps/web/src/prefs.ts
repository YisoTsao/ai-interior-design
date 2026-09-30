import { create } from 'zustand';
import type { AreaUnit, LengthUnit, PlanStyle, SnapSettings } from '@interiorai/editor-2d';
import {
  DEFAULT_GRAPHICS,
  type DisplayMode,
  type LevelsMode,
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
  /** 2D 顯示樣式（FE-PLAN-12） */
  planStyle: PlanStyle;
  setPlanStyle(s: PlanStyle): void;
  /** 格線與吸附（FE-PLAN-13） */
  snap: Required<Pick<SnapSettings, 'gridMm' | 'angleDeg' | 'showGrid'>> & {
    targets: Required<NonNullable<SnapSettings['targets']>>;
  };
  setSnap(p: Partial<Prefs['snap']>): void;
  /** 3D 顯示模式與樓層（FE-V3D-11、FE-LVL-03） */
  displayMode: DisplayMode;
  setDisplayMode(m: DisplayMode): void;
  levelsMode: LevelsMode;
  setLevelsMode(m: LevelsMode): void;
}
const DEFAULT_SNAP: Prefs['snap'] = {
  gridMm: 100,
  angleDeg: 15,
  showGrid: true,
  targets: { endpoint: true, wall: true, angle: true, grid: true },
};
const readJson = <T>(k: string, fb: T): T => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? { ...fb, ...(JSON.parse(raw) as Partial<T>) } : fb;
  } catch {
    return fb;
  }
};
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
  planStyle: read<PlanStyle>('planStyle', 'blueprint'),
  setPlanStyle: (planStyle) => (write('planStyle', planStyle), set({ planStyle })),
  displayMode: read<DisplayMode>('displayMode', 'real'),
  setDisplayMode: (displayMode) => (write('displayMode', displayMode), set({ displayMode })),
  levelsMode: read<LevelsMode>('levelsMode', 'active'),
  setLevelsMode: (levelsMode) => (write('levelsMode', levelsMode), set({ levelsMode })),
  snap: readJson('snapSettings', DEFAULT_SNAP),
  setSnap: (p) =>
    set((st) => {
      const snap = { ...st.snap, ...p, targets: { ...st.snap.targets, ...p.targets } };
      write('snapSettings', JSON.stringify(snap));
      return { snap };
    }),
}));
