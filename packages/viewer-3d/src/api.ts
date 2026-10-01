import type { GBuffer } from './gbuffer.js';
import type { ViewPreset, ViewStyle } from './style.js';

export interface Viewer3DInfo {
  geometries: number;
  textures: number;
  calls: number;
  triangles: number;
  trackedResources: number;
}
export interface BenchResult {
  fps: number;
  p95FrameMs: number;
  drawCalls: number;
  triangles: number;
  frames: number;
}
/** 測試鉤子（03 §9）與外部控制 */
export interface Viewer3DApi {
  info(): Viewer3DInfo;
  /** 相機繞場景中心轉 ms 毫秒並量測（B8 效能量測用） */
  bench(ms: number): Promise<BenchResult>;
  personView(): void;
  frameAll(): void;
  /** 剖面模型的視角預設（簡易模式也可用，會套用剖面相機限制） */
  viewPreset(p: ViewPreset): void;
  style(): ViewStyle;
  lighting(): 'day' | 'night';
  /** 夜間光源統計（測試用）：燈具總數、各池啟用數、投影數、窗戶光源數 */
  lights(): {
    total: number;
    point: number;
    spot: number;
    area: number;
    shadows: number;
    windows: number;
    /** 夜間窗戶（天空）亮度 cd/m² */
    windowLuminance: number;
    /** 間接光（半球光）顯示強度 */
    ambient: number;
  };
  /** 以目前相機產生 G-buffer（03 §6；AI 渲染前置） */
  gbuffer(o: { width: number; height: number; clay?: boolean }): GBuffer;
  /** 目前被降為剖面高度的牆 id（測試用） */
  cutWalls(): string[];
  /** 720° 全景（等距柱狀 JPEG dataURL）；位置預設為目前視點（俯瞰時改在目標點的人眼高度） */
  panorama(o?: { width?: number; at?: [number, number, number] }): string | null;
  /** 指定解析度出圖（2K／4K；transparent＝去背，無後處理）→ PNG dataURL */
  capture(o: { width: number; height: number; transparent?: boolean }): string;
  /** 俯視彩色平面圖（正上方、近似正交）→ PNG dataURL */
  topPlan(o: { width: number; height: number }): string;
  /** 匯出 3D 模型（公尺為單位） */
  exportModel(format: 'glb' | 'obj'): Promise<Blob>;
  /** 以目前畫面（含後處理）輸出 PNG dataURL */
  screenshot(): string | null;
  /** 目前顯示的放置預覽（幽靈物件）數量（測試用） */
  ghosts(): number;
  /** 世界座標（mm）→ 螢幕座標（測試鉤子；E2E 以此找物件位置） */
  worldToClient(p: [number, number, number]): [number, number] | null;
  /** 螢幕座標 → 地面（y=0）世界座標 x,z（拖放資產用） */
  clientToFloor(clientX: number, clientY: number): [number, number] | null;
  /** 螢幕座標下的表面（牆面 A/B、地板、天花、物件、門窗） */
  pickSurface(clientX: number, clientY: number): { kind: string; id: string; side: 'A' | 'B' } | null;
  /** 套用相機書籤 */
  setCamera(c: {
    position: [number, number, number];
    target: [number, number, number];
    fovDeg: number;
  }): void;
  /** 各類型（gkind）網格數量（測試用） */
  kinds(): Record<string, number>;
  /** 目前剖切平面數（測試用） */
  clipPlanes(): number;
  /** 目前 scene.overrideMaterial 類型（測試用） */
  override(): string | null;
  /** 相機焦距（35mm 等效，FE-V3D-10）；回傳目前焦距 */
  setLens(focalMm: number): void;
  lens(): number;
  /** 兩點透視：視線水平，垂直線不傾斜 */
  twoPoint(): void;
  /** 第一人稱漫遊開關 */
  walk(on: boolean): void;
  isWalking(): boolean;
  currentCamera(): { position: [number, number, number]; target: [number, number, number]; fovDeg: number };
}
let current: Viewer3DApi | null = null;
export const viewer3dApi = {
  get: () => current,
  set: (a: Viewer3DApi | null) => {
    current = a;
  },
};

/**
 * 暫時的太陽位置（日照模擬播放時用；不進場景、不進 undo 歷史）。null＝使用場景環境設定。
 */
export type SunOverride = { sunAzimuthDeg: number; sunElevationDeg: number; sunIntensity: number } | null;
let sun: SunOverride = null;
const sunSubs = new Set<() => void>();
export const sunOverride = {
  get: () => sun,
  set: (v: SunOverride) => {
    sun = v;
    sunSubs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    sunSubs.add(f);
    return () => void sunSubs.delete(f);
  },
};

/**
 * 放置預覽（幽靈物件）：從資產庫拖進 3D 視埠時，游標下即時顯示半透明的物件（不入 Scene、不入 undo）。
 * 應用層在 dragover 時以與 drop 相同的放置計算設定，離開／放下時清空。
 */
export interface PlacementGhost {
  catalogId: string;
  position: [number, number, number];
  rotationY: number;
  params?: Record<string, unknown>;
}
let ghosts: readonly PlacementGhost[] = [];
const ghostSubs = new Set<() => void>();
export const placementGhost = {
  get: () => ghosts,
  set: (v: readonly PlacementGhost[]) => {
    if (!v.length && !ghosts.length) return;
    ghosts = v;
    ghostSubs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    ghostSubs.add(f);
    return () => void ghostSubs.delete(f);
  },
};

/**
 * 燈光情境預覽（FE-LGT-05 時間軸播放）：物件 id → 暫時的開關／亮度比例，不寫入 Scene、不進 undo。
 * null＝使用場景中的狀態。
 */
export type LightPreview = ReadonlyMap<string, { on: boolean; level?: number }> | null;
let lp: LightPreview = null;
const lpSubs = new Set<() => void>();
export const lightPreview = {
  get: () => lp,
  set: (v: LightPreview) => {
    lp = v;
    lpSubs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    lpSubs.add(f);
    return () => void lpSubs.delete(f);
  },
};
