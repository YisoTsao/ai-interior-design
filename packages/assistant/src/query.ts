import { computeBOM, findCollisions, overlapArea, wallLength, type Vec2 } from '@interiorai/core-geometry';
import type { SceneObject } from '@interiorai/scene-schema';
import {
  dimsOf,
  footprintOf,
  objectName,
  roomGeometry,
  roomOfObject,
  round,
  type AssistantCtx,
} from './context.js';
import { collisionInputs, polygonGap } from './place.js';
import type { QueryTool } from './tools.js';

/** 走道最小淨寬〔假設〕600 mm（B8 未定義；常見住宅動線 60–90 cm），可由參數覆寫 */
export const DEFAULT_WALKWAY_MM = 600;
/** 參與「走道寬度」檢查的大型家具：佔地 ≥ 0.3 m²（排除餐椅、床頭櫃等緊鄰擺放的小件） */
const LARGE_M2 = 0.3;

export type QueryResult = Record<string, unknown> & { ok: boolean };

export function runQuery(ctx: AssistantCtx, name: QueryTool, args: Record<string, unknown>): QueryResult {
  const roomId = typeof args.room_id === 'string' ? args.room_id : undefined;
  if (roomId && !ctx.level.rooms.some((r) => r.id === roomId))
    return { ok: false, error: 'ROOM_NOT_FOUND', message: `找不到房間 ${roomId}` };
  if (name === 'list_objects') return listObjects(ctx, roomId);
  if (name === 'check_clearance')
    return checkClearance(
      ctx,
      roomId!,
      typeof args.min_walkway_mm === 'number' ? args.min_walkway_mm : undefined,
    );
  return estimateBudget(ctx, args.scope === 'room' ? roomId : undefined);
}

export function listObjects(ctx: AssistantCtx, roomId?: string): QueryResult {
  const objects = ctx.level.objects
    .map((o) => ({ o, room: roomOfObject(ctx, o) }))
    .filter((x) => !roomId || x.room === roomId)
    .map(({ o, room }) => {
      const d = dimsOf(ctx, o);
      return {
        id: o.id,
        name: objectName(ctx, o),
        catalogId: o.catalogId,
        roomId: room,
        position: [round(o.position[0]), round(o.position[2])],
        sizeMm: [round(d.w), round(d.d), round(d.h)],
      };
    });
  return { ok: true, roomId: roomId ?? null, count: objects.length, objects };
}

type Issue =
  | { kind: 'narrow'; a: string; b: string; aName: string; bName: string; gapMm: number }
  | { kind: 'overlap'; a: string; b: string; aName: string; bName: string }
  | { kind: 'in_wall'; a: string; aName: string }
  | { kind: 'door_blocked'; door: string; a: string; aName: string };

/** 走道/門口淨空/重疊檢查（全部由程式計算，B6.4-2） */
export function checkClearance(
  ctx: AssistantCtx,
  roomId: string,
  minWalkway = DEFAULT_WALKWAY_MM,
): QueryResult {
  const lv = ctx.level;
  const room = lv.rooms.find((r) => r.id === roomId)!;
  const g = roomGeometry(lv, room);
  const inRoom = lv.objects.filter((o) => roomOfObject(ctx, o) === roomId);
  const floorObjs = inRoom.filter((o) => {
    const e = ctx.catalog.get(o.catalogId);
    return (e?.anchor ?? 'floor') === 'floor' && dimsOf(ctx, o).h > 30 && o.position[1] < 300;
  });
  const name = (o: SceneObject) => objectName(ctx, o);
  const issues: Issue[] = [];
  for (const c of findCollisions(lv, collisionInputs(ctx, inRoom))) {
    const a = inRoom.find((o) => o.id === c.objectId)!;
    if (c.kind === 'wall') issues.push({ kind: 'in_wall', a: a.id, aName: name(a) });
    else {
      const b = inRoom.find((o) => o.id === c.otherId)!;
      issues.push({ kind: 'overlap', a: a.id, b: b.id, aName: name(a), bName: name(b) });
    }
  }
  const large = floorObjs.filter((o) => {
    const d = dimsOf(ctx, o);
    return (d.w * d.d) / 1e6 >= LARGE_M2;
  });
  for (let i = 0; i < large.length; i++)
    for (let j = i + 1; j < large.length; j++) {
      const a = large[i]!;
      const b = large[j]!;
      const gap = polygonGap(footprintOf(ctx, a), footprintOf(ctx, b));
      if (gap > 0 && gap < minWalkway)
        issues.push({ kind: 'narrow', a: a.id, b: b.id, aName: name(a), bName: name(b), gapMm: round(gap) });
    }
  // 門口淨空：門寬 × 門寬的矩形（開門迴轉範圍），落在房間這一側
  if (g) {
    const cx = g.centerline.reduce((s, p) => s + p[0], 0) / g.centerline.length;
    const cz = g.centerline.reduce((s, p) => s + p[1], 0) / g.centerline.length;
    for (const o of lv.openings.filter((x) => x.type === 'door')) {
      const w = lv.walls.find((x) => x.id === o.wallId)!;
      const L = wallLength(w) || 1;
      const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const n: Vec2 = [-d[1], d[0]];
      const s = (cx - w.a[0]) * n[0] + (cz - w.a[1]) * n[1] >= 0 ? 1 : -1;
      const p0: Vec2 = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset];
      const p1: Vec2 = [p0[0] + d[0] * o.width, p0[1] + d[1] * o.width];
      const off = w.thickness / 2;
      const depth = off + o.width;
      const zone: Vec2[] = [
        [p0[0] + n[0] * s * off, p0[1] + n[1] * s * off],
        [p1[0] + n[0] * s * off, p1[1] + n[1] * s * off],
        [p1[0] + n[0] * s * depth, p1[1] + n[1] * s * depth],
        [p0[0] + n[0] * s * depth, p0[1] + n[1] * s * depth],
      ];
      // 門的迴轉區必須在此房間內（隔間門兩側各屬一房）
      const mid: Vec2 = [(zone[0]![0] + zone[2]![0]) / 2, (zone[0]![1] + zone[2]![1]) / 2];
      if (!pointInCenterline(g.centerline, mid)) continue;
      for (const f of floorObjs)
        if (overlapArea(footprintOf(ctx, f), zone) >= 2500)
          issues.push({ kind: 'door_blocked', door: o.id, a: f.id, aName: name(f) });
    }
  }
  return {
    ok: true,
    roomId,
    roomLabel: room.label ?? null,
    minWalkwayMm: minWalkway,
    passed: issues.length === 0,
    issues,
  };
}

function pointInCenterline(poly: readonly Vec2[], p: Vec2) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 估價：BOM 由 core-geometry 計算；價格為目錄/材質的參考價〔假設〕 */
export function estimateBudget(ctx: AssistantCtx, roomId?: string): QueryResult {
  const prices = Object.fromEntries(
    [...ctx.materials.values()].map((m) => [m.id, { pricePerM2Twd: m.pricePerM2Twd }]),
  );
  const bom = computeBOM(
    { ...ctx.scene, levels: [ctx.level] },
    { get: (id) => ctx.catalog.get(id) },
    prices,
    roomId ? { roomId } : {},
  );
  const nameOf = (kind: string, key: string) =>
    kind === 'object' || kind === 'opening'
      ? (ctx.catalog.get(key)?.nameZh ?? key)
      : (ctx.materials.get(key)?.nameZh ?? key);
  return {
    ok: true,
    scope: roomId ? 'room' : 'project',
    roomId: roomId ?? null,
    currency: 'TWD',
    priceNote: '參考價〔假設〕，未經市場查價',
    totalTwd: bom.totalTwd,
    lines: bom.lines.map((l) => ({ ...l, name: nameOf(l.kind, l.key) })),
    unpriced: bom.unpricedKeys.map((k) => ctx.catalog.get(k)?.nameZh ?? ctx.materials.get(k)?.nameZh ?? k),
  };
}
