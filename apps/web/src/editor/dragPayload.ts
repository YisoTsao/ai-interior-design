import { placementGhost } from '@interiorai/viewer-3d';

/**
 * 目前從資產庫／套組拖曳中的項目。HTML5 拖放在 dragover 期間讀不到 dataTransfer 的內容
 * （只有 types），所以在 dragstart 記下，供 3D 視埠即時顯示放置預覽（FE-V3D-02）。
 */
export type DragPayload = { kind: 'catalog' | 'set'; id: string } | null;
let current: DragPayload = null;

export const dragPayload = {
  get: () => current,
  start: (p: Exclude<DragPayload, null>) => {
    current = p;
  },
  end: () => {
    current = null;
    placementGhost.set([]);
  },
};
