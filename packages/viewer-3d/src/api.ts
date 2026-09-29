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
  currentCamera(): { position: [number, number, number]; target: [number, number, number]; fovDeg: number };
}
let current: Viewer3DApi | null = null;
export const viewer3dApi = {
  get: () => current,
  set: (a: Viewer3DApi | null) => {
    current = a;
  },
};
