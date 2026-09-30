import type { Vec2 } from '@interiorai/core-geometry';

/** 測試鉤子與外部控制（03 §9：E2E 以 window.__editor 輔助畫布操作） */
export interface Plan2DApi {
  worldToClient(p: Vec2): Vec2;
  clientToWorld(p: Vec2): Vec2;
  fit(): void;
  /** 游標最後所在的世界座標（貼上位置用） */
  pointerWorld(): Vec2 | null;
  /** 2D 畫面 PNG（專案縮圖、匯出） */
  snapshot(maxSide?: number): string | null;
  /** 測量工具目前的點（底圖比例校正用） */
  measurePoints(): Vec2[];
}
let current: Plan2DApi | null = null;
export const plan2dApi = {
  get: () => current,
  set: (a: Plan2DApi | null) => {
    current = a;
  },
};
