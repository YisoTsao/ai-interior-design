import { LIMITS, type Level, type Wall } from '@interiorai/scene-schema';
import { areCollinearJoined, JOINT_TOLERANCE, wallLength } from './walls.js';
import { add, eq, norm, roundVec, scale, sub, type Vec2 } from './vec.js';

export type EditViolationCode = 'WALL_NOT_FOUND' | 'WALL_TOO_SHORT' | 'OPENING_OUT_OF_RANGE';
export interface EditViolation {
  code: EditViolationCode;
  id: string;
  message: string;
}
/** 有 violation 時 level 為原值（阻止，B3.3），呼叫端顯示提示 */
export interface EditResult {
  level: Level;
  changedWallIds: string[];
  violations: EditViolation[];
}

export interface EndRef {
  wallId: string;
  end: 'a' | 'b';
}

const clone = (l: Level): Level => JSON.parse(JSON.stringify(l)) as Level;

function check(level: Level, changed: Set<string>): EditViolation[] {
  const v: EditViolation[] = [];
  for (const w of level.walls) {
    if (!changed.has(w.id)) continue;
    const l = wallLength(w);
    if (l < LIMITS.minWallLength)
      v.push({ code: 'WALL_TOO_SHORT', id: w.id, message: `牆 ${w.id} 將短於 100mm` });
    for (const o of level.openings)
      if (o.wallId === w.id && o.offset + o.width > l + 1)
        v.push({ code: 'OPENING_OUT_OF_RANGE', id: o.id, message: `開口 ${o.id} 將超出牆 ${w.id}` });
  }
  return v;
}

function finish(original: Level, next: Level, changed: Set<string>): EditResult {
  const violations = check(next, changed);
  return violations.length
    ? { level: original, changedWallIds: [], violations }
    : { level: next, changedWallIds: [...changed], violations: [] };
}

const setEnd = (w: Wall, end: 'a' | 'b', p: Vec2) => {
  if (end === 'a') w.a = [p[0], p[1]];
  else w.b = [p[0], p[1]];
};

/**
 * 拖動牆頂點：與該端點相接的所有牆端一起移動（S1.7、B3.4）。
 * 開口以 offset（距 a 端）保持；若因此超出牆長則阻止並回 violation。
 */
export function moveWallVertex(level: Level, ref: EndRef, to: Vec2): EditResult {
  const src = level.walls.find((w) => w.id === ref.wallId);
  if (!src)
    return {
      level,
      changedWallIds: [],
      violations: [{ code: 'WALL_NOT_FOUND', id: ref.wallId, message: '找不到牆' }],
    };
  const from = (ref.end === 'a' ? src.a : src.b) as Vec2;
  const target = roundVec(to);
  const next = clone(level);
  const changed = new Set<string>();
  for (const w of next.walls) {
    for (const end of ['a', 'b'] as const) {
      if (eq((end === 'a' ? w.a : w.b) as Vec2, from, JOINT_TOLERANCE)) {
        setEnd(w, end, target);
        changed.add(w.id);
      }
    }
  }
  return finish(level, next, changed);
}

/**
 * 修改單面牆長度並保持相鄰牆角度不變（B4、FR-202）：
 * 被移動端相接的牆整體平移；平移牆另一端相接的牆只移動該端點（伸縮）。
 */
export function resizeWall(
  level: Level,
  wallId: string,
  newLength: number,
  keep: 'start' | 'end' | 'center' = 'start',
): EditResult {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w)
    return {
      level,
      changedWallIds: [],
      violations: [{ code: 'WALL_NOT_FOUND', id: wallId, message: '找不到牆' }],
    };
  const dir = norm(sub(w.b as Vec2, w.a as Vec2));
  const delta = newLength - wallLength(w);
  const moves: { end: 'a' | 'b'; d: Vec2 }[] =
    keep === 'start'
      ? [{ end: 'b', d: scale(dir, delta) }]
      : keep === 'end'
        ? [{ end: 'a', d: scale(dir, -delta) }]
        : [
            { end: 'a', d: scale(dir, -delta / 2) },
            { end: 'b', d: scale(dir, delta / 2) },
          ];

  const next = clone(level);
  const changed = new Set<string>([wallId]);
  for (const m of moves) {
    const self = next.walls.find((x) => x.id === wallId)!;
    const p = (m.end === 'a' ? self.a : self.b) as Vec2;
    const moved = new Map<string, Vec2>(); // 舊點 → 新點（被平移牆的遠端）
    for (const o of next.walls) {
      if (o.id === wallId) continue;
      for (const end of ['a', 'b'] as const) {
        if (!eq((end === 'a' ? o.a : o.b) as Vec2, p, JOINT_TOLERANCE)) continue;
        const far = (end === 'a' ? o.b : o.a) as Vec2;
        moved.set(`${far[0]},${far[1]}`, roundVec(add(far, m.d)));
        o.a = roundVec(add(o.a as Vec2, m.d));
        o.b = roundVec(add(o.b as Vec2, m.d));
        changed.add(o.id);
      }
    }
    setEnd(self, m.end, roundVec(add(p, m.d)));
    for (const o of next.walls) {
      if (changed.has(o.id)) continue;
      for (const end of ['a', 'b'] as const) {
        const q = (end === 'a' ? o.a : o.b) as Vec2;
        const t = moved.get(`${q[0]},${q[1]}`);
        if (t) {
          setEnd(o, end, t);
          changed.add(o.id);
        }
      }
    }
  }
  return finish(level, next, changed);
}

/** 共線且相接、厚度相同、接點無第三面牆的牆自動合併（B3.2）。開口 offset 會換算到合併後的牆。 */
export function mergeCollinearWalls(level: Level): Level {
  const next = clone(level);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (const a of next.walls) {
      for (const b of next.walls) {
        if (a.id === b.id || !areCollinearJoined(a, b) || a.type !== b.type || a.materialId !== b.materialId)
          continue;
        const pts = [a.a, a.b, b.a, b.b] as Vec2[];
        const shared = pts.find((p, i) => pts.findIndex((q) => eq(p, q, JOINT_TOLERANCE)) !== i)!;
        const others = next.walls.filter(
          (w) =>
            w.id !== a.id &&
            w.id !== b.id &&
            (eq(w.a as Vec2, shared, JOINT_TOLERANCE) || eq(w.b as Vec2, shared, JOINT_TOLERANCE)),
        );
        if (others.length) continue;
        const aStart = (eq(a.a as Vec2, shared, JOINT_TOLERANCE) ? a.b : a.a) as Vec2;
        const bEnd = (eq(b.a as Vec2, shared, JOINT_TOLERANCE) ? b.b : b.a) as Vec2;
        const bReversed = !eq(b.a as Vec2, shared, JOINT_TOLERANCE);
        const aReversed = eq(a.a as Vec2, shared, JOINT_TOLERANCE);
        const aLen = wallLength(a);
        const bLen = wallLength(b);
        const mergedWall: Wall = { ...a, a: [aStart[0], aStart[1]], b: [bEnd[0], bEnd[1]] };
        next.openings = next.openings.map((o) => {
          if (o.wallId === a.id)
            return aReversed ? { ...o, offset: Math.round(aLen - o.offset - o.width) } : o;
          if (o.wallId === b.id) {
            const off = bReversed ? bLen - o.offset - o.width : o.offset;
            return { ...o, wallId: a.id, offset: Math.round(aLen + off) };
          }
          return o;
        });
        next.rooms = next.rooms.map((r) => ({
          ...r,
          wallIds: [...new Set(r.wallIds.map((id) => (id === b.id ? a.id : id)))],
        }));
        next.walls = next.walls.filter((w) => w.id !== b.id).map((w) => (w.id === a.id ? mergedWall : w));
        merged = true;
        break outer;
      }
    }
  }
  return next;
}
