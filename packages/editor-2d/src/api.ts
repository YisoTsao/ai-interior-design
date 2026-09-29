import type { Vec2 } from '@interiorai/core-geometry';

/** 測試鉤子與外部控制（03 §9：E2E 以 window.__editor 輔助畫布操作） */
export interface Plan2DApi {
  worldToClient(p: Vec2): Vec2;
  clientToWorld(p: Vec2): Vec2;
  fit(): void;
}
let current: Plan2DApi | null = null;
export const plan2dApi = {
  get: () => current,
  set: (a: Plan2DApi | null) => {
    current = a;
  },
};
