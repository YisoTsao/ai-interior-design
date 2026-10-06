import type { Draft } from 'immer';
import type { Scene } from '@interiorai/scene-schema';
import type { Command } from './history.js';

/**
 * 版本比較與還原（FE-SHR-04）：以 id 比對兩版的家具、牆、門窗、房間。
 * moved＝位置／旋轉改變；changed＝其他屬性改變（材質、尺寸…）。
 */
export interface SceneDiff {
  added: string[];
  removed: string[];
  moved: string[];
  changed: string[];
  summary: {
    objects: [number, number, number, number];
    walls: [number, number, number];
    openings: [number, number, number];
  };
}
type Entity = { id: string } & Record<string, unknown>;
const byId = <T extends Entity>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffScenes(from: Scene, to: Scene): SceneDiff {
  const all = (s: Scene, k: 'objects' | 'walls' | 'openings' | 'rooms') =>
    s.levels.flatMap((l) => l[k] as unknown as Entity[]);
  const out: SceneDiff = {
    added: [],
    removed: [],
    moved: [],
    changed: [],
    summary: { objects: [0, 0, 0, 0], walls: [0, 0, 0], openings: [0, 0, 0] },
  };
  for (const k of ['objects', 'walls', 'openings', 'rooms'] as const) {
    const a = byId(all(from, k));
    const b = byId(all(to, k));
    for (const [id, x] of b) {
      const old = a.get(id);
      if (!old) {
        out.added.push(id);
        if (k === 'objects') out.summary.objects[0]++;
        else if (k === 'walls') out.summary.walls[0]++;
        else if (k === 'openings') out.summary.openings[0]++;
        continue;
      }
      if (same(old, x)) continue;
      const pose = (e: Entity) => JSON.stringify([e.position, e.rotationY, e.a, e.b, e.offset]);
      const { position: _p, rotationY: _r, a: _a, b: _b, offset: _o, ...restOld } = old;
      const { position: _p2, rotationY: _r2, a: _a2, b: _b2, offset: _o2, ...restNew } = x;
      if (pose(old) !== pose(x)) {
        out.moved.push(id);
        if (k === 'objects') out.summary.objects[2]++;
      }
      if (!same(restOld, restNew)) {
        out.changed.push(id);
        if (k === 'objects') out.summary.objects[3]++;
        else if (k === 'walls') out.summary.walls[2]++;
        else if (k === 'openings') out.summary.openings[2]++;
      } else if (k === 'walls' && pose(old) !== pose(x)) out.summary.walls[2]++;
    }
    for (const id of a.keys())
      if (!b.has(id)) {
        out.removed.push(id);
        if (k === 'objects') out.summary.objects[1]++;
        else if (k === 'walls') out.summary.walls[1]++;
        else if (k === 'openings') out.summary.openings[1]++;
      }
  }
  return out;
}

/** 還原到某一版（一個 Command → 可復原）：替換樓層、相機、環境與中繼資料 */
export function restoreScene(target: Scene): Command {
  return {
    id: `restore_${Date.now().toString(36)}`,
    label: 'command.restoreVersion',
    do: (d) => {
      const t = JSON.parse(JSON.stringify(target)) as Scene;
      const dd = d as Draft<Scene> & Record<string, unknown>;
      for (const k of Object.keys(dd)) if (!(k in t)) delete dd[k];
      Object.assign(dd, t);
    },
  };
}
