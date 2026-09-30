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
  /** 以目前畫面（含後處理）輸出 PNG dataURL */
  screenshot(): string | null;
  currentCamera(): { position: [number, number, number]; target: [number, number, number]; fovDeg: number };
}
let current: Viewer3DApi | null = null;
export const viewer3dApi = {
  get: () => current,
  set: (a: Viewer3DApi | null) => {
    current = a;
  },
};
