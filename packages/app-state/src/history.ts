import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { Scene } from '@interiorai/scene-schema';

enablePatches();

/** 對 Scene 的原子修改（B4）；do 內只能改 draft，不得有副作用 */
export interface Command {
  id: string;
  label: string;
  do(draft: Draft<Scene>): void;
}

/** 由 Command 丟出，表示違反約束而被阻止（B3.3）；不會進入歷史 */
export class CommandRejected extends Error {
  constructor(readonly reasons: { code: string; id: string; message: string }[]) {
    super(reasons.map((r) => r.message).join('；'));
  }
}

export interface HistoryEntry {
  commandId: string;
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 200;

/** 執行 Command：回傳新 scene 與歷史；scene 未變則不記錄 */
export function execCommand(
  scene: Scene,
  h: HistoryState,
  cmd: Command,
): { scene: Scene; history: HistoryState; changed: boolean } {
  const [next, patches, inverse] = produceWithPatches(scene, (d) => {
    cmd.do(d);
  });
  if (patches.length === 0) return { scene, history: h, changed: false };
  const past = [...h.past, { commandId: cmd.id, label: cmd.label, patches, inverse }].slice(-HISTORY_LIMIT);
  return { scene: next, history: { past, future: [] }, changed: true };
}

export function undo(
  scene: Scene,
  h: HistoryState,
): { scene: Scene; history: HistoryState; entry?: HistoryEntry } {
  const entry = h.past[h.past.length - 1];
  if (!entry) return { scene, history: h };
  return {
    scene: applyPatches(scene, entry.inverse),
    history: { past: h.past.slice(0, -1), future: [entry, ...h.future] },
    entry,
  };
}

export function redo(
  scene: Scene,
  h: HistoryState,
): { scene: Scene; history: HistoryState; entry?: HistoryEntry } {
  const entry = h.future[0];
  if (!entry) return { scene, history: h };
  return {
    scene: applyPatches(scene, entry.patches),
    history: { past: [...h.past, entry], future: h.future.slice(1) },
    entry,
  };
}
