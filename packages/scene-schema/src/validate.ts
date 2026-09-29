import { LIMITS, SceneSchema, type Scene } from './schema.js';

export type SceneErrorCode =
  | 'SCHEMA'
  | 'DUPLICATE_ID'
  | 'WALL_TOO_SHORT'
  | 'WALL_THICKER_THAN_LENGTH'
  | 'DANGLING_REF'
  | 'OPENING_OUT_OF_WALL'
  | 'OPENING_TOO_TALL'
  | 'OPENING_OVERLAP'
  | 'ROOM_DUPLICATE_WALL';

export interface SceneIssue {
  code: SceneErrorCode;
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; scene: Scene; issues: [] } | { ok: false; issues: SceneIssue[] };

const wallLen = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));

/** 語意檢查（與 validate_scene.py 對齊；規則見 ADR-013）。前提：已通過結構驗證。 */
export function semanticIssues(scene: Scene): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const push = (code: SceneErrorCode, path: string, message: string) => issues.push({ code, path, message });

  scene.levels.forEach((lvl, li) => {
    const base = `/levels/${li}`;
    const seen = new Map<string, string>();
    const reg = (id: string, path: string) => {
      if (seen.has(id)) push('DUPLICATE_ID', path, `重複的 id：${id}（亦見於 ${seen.get(id)}）`);
      else seen.set(id, path);
    };
    lvl.walls.forEach((w, i) => reg(w.id, `${base}/walls/${i}`));
    lvl.openings.forEach((o, i) => reg(o.id, `${base}/openings/${i}`));
    lvl.rooms.forEach((r, i) => reg(r.id, `${base}/rooms/${i}`));
    lvl.objects.forEach((o, i) => reg(o.id, `${base}/objects/${i}`));

    const walls = new Map(lvl.walls.map((w) => [w.id, w]));
    lvl.walls.forEach((w, i) => {
      const len = wallLen(w.a, w.b);
      if (len < LIMITS.minWallLength)
        push('WALL_TOO_SHORT', `${base}/walls/${i}`, `牆 ${w.id} 過短（<100mm）`);
      else if (w.thickness >= len)
        push('WALL_THICKER_THAN_LENGTH', `${base}/walls/${i}`, `牆 ${w.id} 厚度不得大於等於長度`);
    });

    const byWall = new Map<string, { offset: number; width: number; id: string }[]>();
    lvl.openings.forEach((o, i) => {
      const p = `${base}/openings/${i}`;
      const w = walls.get(o.wallId);
      if (!w) return push('DANGLING_REF', p, `開口 ${o.id} 指向不存在的牆 ${o.wallId}`);
      if (o.offset + o.width > wallLen(w.a, w.b) + 1)
        push('OPENING_OUT_OF_WALL', p, `開口 ${o.id} 超出牆 ${w.id}`);
      if ((o.sill ?? 0) + o.height > lvl.height) push('OPENING_TOO_TALL', p, `開口 ${o.id} 高度超過樓層高度`);
      const list = byWall.get(o.wallId) ?? [];
      list.push({ offset: o.offset, width: o.width, id: o.id });
      byWall.set(o.wallId, list);
    });
    for (const [wid, ops] of byWall) {
      ops.sort((x, y) => x.offset - y.offset);
      for (let k = 1; k < ops.length; k++) {
        const prev = ops[k - 1]!;
        const cur = ops[k]!;
        if (prev.offset + prev.width > cur.offset)
          push('OPENING_OVERLAP', `${base}/openings`, `牆 ${wid} 上開口 ${prev.id} 與 ${cur.id} 重疊`);
      }
    }

    const roomIds = new Set(lvl.rooms.map((r) => r.id));
    lvl.rooms.forEach((r, i) => {
      const p = `${base}/rooms/${i}`;
      if (new Set(r.wallIds).size !== r.wallIds.length)
        push('ROOM_DUPLICATE_WALL', p, `房間 ${r.id} 的 wallIds 重複`);
      for (const wid of r.wallIds)
        if (!walls.has(wid)) push('DANGLING_REF', p, `房間 ${r.id} 指向不存在的牆 ${wid}`);
    });
    lvl.objects.forEach((o, i) => {
      if (o.roomId && !roomIds.has(o.roomId))
        push('DANGLING_REF', `${base}/objects/${i}`, `物件 ${o.id} 指向不存在的房間 ${o.roomId}`);
    });
  });

  const cams = scene.cameras ?? [];
  if (new Set(cams.map((c) => c.id)).size !== cams.length) push('DUPLICATE_ID', '/cameras', '相機 id 重複');
  return issues;
}

/** 讀入與寫出都必須通過（B2）。結構錯誤時不跑語意檢查。 */
export function validateScene(input: unknown): ValidationResult {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'SCHEMA' as const,
        path: '/' + i.path.map(String).join('/'),
        message: i.message,
      })),
    };
  }
  const issues = semanticIssues(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, scene: parsed.data, issues: [] };
}
