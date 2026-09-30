import {
  addObject,
  CommandRejected,
  execCommand,
  resizeWall,
  setMaterial,
  transformObject,
  type Command,
  type MaterialTarget,
} from '@interiorai/app-state';
import { objectDims } from '@interiorai/catalog';
import { roomWallFaces, wallLength, type Vec2 } from '@interiorai/core-geometry';
import { newId, type Level, type Scene, type SceneObject } from '@interiorai/scene-schema';
import {
  dimsOf,
  isPublished,
  objectName,
  roomGeometry,
  roomOfObject,
  round,
  wallName,
  type AssistantCtx,
} from './context.js';
import {
  againstWall,
  atWindow,
  besideObject,
  collisionsAfter,
  freeSpot,
  type Pose,
  type Side,
} from './place.js';
import { checkClearance } from './query.js';
import type { ProposalTool, ToolCall } from './tools.js';

/** 一項結構化變更（預覽/差異用；UI 以 i18n 呈現） */
export type Change =
  | {
      kind: 'move';
      objectId: string;
      name: string;
      from: { x: number; z: number; rotationDeg: number };
      to: { x: number; z: number; rotationDeg: number };
      position: [number, number, number];
      rotationY: number;
    }
  | {
      kind: 'resize_wall';
      wallId: string;
      name: string;
      fromMm: number;
      toMm: number;
      keep: 'start' | 'end' | 'center';
    }
  | { kind: 'add'; object: SceneObject; name: string; roomId: string; roomLabel: string | null }
  | {
      kind: 'material';
      target: MaterialTarget;
      targetName: string;
      fromId: string | null;
      toId: string;
      fromName: string | null;
      toName: string;
    };

export interface Proposal {
  id: string;
  tool: ProposalTool;
  args: Record<string, unknown>;
  changes: Change[];
  /** 程式偵測到的後果（重疊、走道不足…）；只提示，不阻擋 */
  warnings: string[];
}
export type ResolveResult = { ok: true; proposal: Proposal } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ResolveResult => ({ ok: false, code, message });
const deg = (r: number) => round(((((r * 180) / Math.PI) % 360) + 360) % 360);
const normRad = (r: number) => Math.round((((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1e6) / 1e6;

const FLOOR_CATS = ['floor', 'wood', 'stone'];
const WALL_CATS = ['wall', 'stone', 'wood'];
const CEILING_CATS = ['ceiling', 'wall'];
const OBJECT_CATS = ['fabric', 'wood', 'metal', 'stone'];

/** 提案型工具呼叫 → 結構化變更（不修改場景；B6.4-3） */
export function resolveProposal(ctx: AssistantCtx, call: ToolCall): ResolveResult {
  const a = call.arguments;
  let r: ResolveResult;
  switch (call.name) {
    case 'move_object':
      r = resolveMove(ctx, a);
      break;
    case 'resize_wall':
      r = resolveResize(ctx, a);
      break;
    case 'add_object':
      r = resolveAdd(ctx, a);
      break;
    case 'set_material':
      r = resolveMaterial(ctx, a);
      break;
    case 'suggest_layout':
      r = suggestLayout(ctx, a);
      break;
    default:
      return fail('NOT_A_PROPOSAL', `${call.name} 不是提案型工具`);
  }
  if (!r.ok) return r;
  const proposal = { ...r.proposal, id: call.id, tool: call.name as ProposalTool, args: a };
  // 乾跑：確認 Command 在目前場景可套用（違反約束者直接回報，不讓使用者確認一個會失敗的提案）
  if (proposal.changes.length) {
    try {
      execCommand(ctx.scene, { past: [], future: [] }, proposalCommand(ctx.level.id, proposal));
    } catch (e) {
      if (e instanceof CommandRejected) return fail(e.reasons[0]?.code ?? 'REJECTED', e.message);
      throw e;
    }
  }
  return { ok: true, proposal };
}

function moveChange(ctx: AssistantCtx, o: SceneObject, pose: Pose): Change {
  const rotationY = normRad(pose.rotationY);
  return {
    kind: 'move',
    objectId: o.id,
    name: objectName(ctx, o),
    from: { x: round(o.position[0]), z: round(o.position[2]), rotationDeg: deg(o.rotationY) },
    to: { x: round(pose.x), z: round(pose.z), rotationDeg: deg(rotationY) },
    position: [round(pose.x), o.position[1], round(pose.z)],
    rotationY,
  };
}

function collisionWarnings(ctx: AssistantCtx, o: SceneObject, pose: Pose): string[] {
  return collisionsAfter(ctx, o, pose).map((c) => {
    if (c.kind === 'wall') return `「${objectName(ctx, o)}」會穿入牆體`;
    const other = ctx.level.objects.find((x) => x.id === (c.objectId === o.id ? c.otherId : c.objectId));
    return `「${objectName(ctx, o)}」會與「${other ? objectName(ctx, other) : c.otherId}」重疊`;
  });
}

/** 相對擺放：anchor＝wall/window/object */
function relativePose(
  ctx: AssistantCtx,
  mover: SceneObject,
  anchor: 'wall' | 'window' | 'object',
  refId: string,
  side: Side,
  gap: number,
  roomId: string | null,
): Pose | ResolveResult {
  const lv = ctx.level;
  const d = dimsOf(ctx, mover);
  const body = { w: d.w, d: d.d, rotationY: mover.rotationY };
  const room = roomId ? lv.rooms.find((r) => r.id === roomId) : undefined;
  const g = room && roomGeometry(lv, room);
  const roomPoint: Vec2 = g ? centroid(g.floor) : [mover.position[0], mover.position[2]];
  if (anchor === 'object') {
    const ref = lv.objects.find((o) => o.id === refId);
    if (!ref || ref.id === mover.id) return fail('OBJECT_NOT_FOUND', `找不到參考物件 ${refId}`);
    return besideObject(ctx, body, ref, side, gap);
  }
  if (anchor === 'window') {
    const op = lv.openings.find((o) => o.id === refId);
    if (!op) return fail('OPENING_NOT_FOUND', `找不到窗戶 ${refId}`);
    return atWindow(ctx, d, lv, refId, roomPoint, side, gap)!;
  }
  const w = lv.walls.find((x) => x.id === refId);
  if (!w) return fail('WALL_NOT_FOUND', `找不到牆 ${refId}`);
  return againstWall(ctx, d, w, roomPoint, null, gap, g?.centerline);
}

const centroid = (poly: readonly Vec2[]): Vec2 => [
  poly.reduce((s, p) => s + p[0], 0) / poly.length,
  poly.reduce((s, p) => s + p[1], 0) / poly.length,
];

function resolveMove(ctx: AssistantCtx, a: Record<string, unknown>): ResolveResult {
  const o = ctx.level.objects.find((x) => x.id === a.id);
  if (!o) return fail('OBJECT_NOT_FOUND', `找不到物件 ${String(a.id)}`);
  if (o.locked) return fail('OBJECT_LOCKED', `「${objectName(ctx, o)}」已鎖定`);
  const to = a.to as
    | {
        position?: [number, number];
        offset_mm?: [number, number];
        forward_mm?: number;
        relative?: Record<string, unknown>;
      }
    | undefined;
  let pose: Pose = { x: o.position[0], z: o.position[2], rotationY: o.rotationY };
  if (to?.position) pose = { ...pose, x: to.position[0], z: to.position[1] };
  else if (to?.offset_mm) pose = { ...pose, x: pose.x + to.offset_mm[0], z: pose.z + to.offset_mm[1] };
  else if (typeof to?.forward_mm === 'number')
    pose = {
      ...pose,
      x: pose.x + Math.sin(o.rotationY) * to.forward_mm,
      z: pose.z + Math.cos(o.rotationY) * to.forward_mm,
    };
  else if (to?.relative) {
    const r = to.relative as {
      anchor: 'wall' | 'window' | 'object';
      ref_id: string;
      side: Side;
      gap_mm?: number;
    };
    const p = relativePose(ctx, o, r.anchor, r.ref_id, r.side, r.gap_mm ?? 0, roomOfObject(ctx, o));
    if ('ok' in p) return p;
    pose = p;
  }
  if (typeof a.rotate_deg === 'number')
    pose = { ...pose, rotationY: pose.rotationY + (a.rotate_deg * Math.PI) / 180 };
  const change = moveChange(ctx, o, pose);
  const warnings = collisionWarnings(ctx, o, pose);
  return { ok: true, proposal: { id: '', tool: 'move_object', args: a, changes: [change], warnings } };
}

function resolveResize(ctx: AssistantCtx, a: Record<string, unknown>): ResolveResult {
  const w = ctx.level.walls.find((x) => x.id === a.wall_id);
  if (!w) return fail('WALL_NOT_FOUND', `找不到牆 ${String(a.wall_id)}`);
  const keep = (a.keep as 'start' | 'end' | 'center' | undefined) ?? 'start';
  const change: Change = {
    kind: 'resize_wall',
    wallId: w.id,
    name: wallName(ctx.level, w),
    fromMm: round(wallLength(w)),
    toMm: round(a.new_length_mm as number),
    keep,
  };
  return { ok: true, proposal: { id: '', tool: 'resize_wall', args: a, changes: [change], warnings: [] } };
}

function resolveAdd(ctx: AssistantCtx, a: Record<string, unknown>): ResolveResult {
  const e = ctx.catalog.get(String(a.catalog_id));
  if (!isPublished(e) || e.category === 'openings')
    return fail('CATALOG_NOT_FOUND', `目錄中沒有可新增的 ${String(a.catalog_id)}`);
  const room = ctx.level.rooms.find((r) => r.id === a.room_id);
  const g = room && roomGeometry(ctx.level, room);
  if (!room || !g) return fail('ROOM_NOT_FOUND', `找不到房間 ${String(a.room_id)}`);
  const dims = objectDims(e, {});
  const y =
    e.anchor === 'ceiling'
      ? ctx.level.height - dims.h
      : e.anchor === 'wall'
        ? e.id === 'curtain_pair'
          ? 0
          : 1400
        : 0;
  const obj: SceneObject = {
    id: newId('obj'),
    catalogId: e.id,
    position: [0, y, 0],
    rotationY: 0,
    scale: [1, 1, 1],
    roomId: room.id,
  };
  let pose: Pose | null = null;
  const anchorId = typeof a.anchor === 'string' ? a.anchor : null;
  const side = (a.side as Side | undefined) ?? 'front';
  if (anchorId) {
    const kind = ctx.level.objects.some((o) => o.id === anchorId)
      ? 'object'
      : ctx.level.openings.some((o) => o.id === anchorId)
        ? 'window'
        : ctx.level.walls.some((w) => w.id === anchorId)
          ? 'wall'
          : null;
    if (!kind) return fail('ANCHOR_NOT_FOUND', `找不到參考對象 ${anchorId}`);
    const c = centroid(g.floor);
    const seed: SceneObject = { ...obj, position: [c[0], y, c[1]] };
    const p = relativePose(ctx, seed, kind, anchorId, side, 0, room.id);
    if ('ok' in p) return p;
    pose = p;
  } else if (e.anchor === 'wall') {
    // 壁掛物：掛在房間最長的牆面中央
    const faces = roomWallFaces(ctx.level, g).sort((x, y2) => y2.areaMm2 - x.areaMm2);
    const w = faces[0] && ctx.level.walls.find((x) => x.id === faces[0]!.wallId);
    if (!w) return fail('NO_WALL', '房間沒有可掛的牆面');
    pose = againstWall(ctx, dims, w, centroid(g.floor), null, 0, g.centerline);
  } else {
    pose = freeSpot(ctx, obj, room.id);
    if (!pose) return fail('NO_SPACE', `「${room.label ?? room.id}」沒有足夠的空位放「${e.nameZh}」`);
  }
  const placed: SceneObject = {
    ...obj,
    position: [round(pose.x), y, round(pose.z)],
    rotationY: normRad(pose.rotationY),
  };
  const warnings = e.anchor === 'floor' ? collisionWarnings(ctx, placed, pose) : [];
  return {
    ok: true,
    proposal: {
      id: '',
      tool: 'add_object',
      args: a,
      changes: [
        { kind: 'add', object: placed, name: e.nameZh, roomId: room.id, roomLabel: room.label ?? null },
      ],
      warnings,
    },
  };
}

function resolveMaterial(ctx: AssistantCtx, a: Record<string, unknown>): ResolveResult {
  const lv = ctx.level;
  const m = ctx.materials.get(String(a.material_id));
  if (!m) return fail('MATERIAL_NOT_FOUND', `找不到材質 ${String(a.material_id)}`);
  const surface = a.surface as string | undefined;
  const id = String(a.target_id);
  const nameOf = (mid?: string | null) => (mid ? (ctx.materials.get(mid)?.nameZh ?? mid) : null);
  const mk = (target: MaterialTarget, targetName: string, fromId: string | null | undefined): Change => ({
    kind: 'material',
    target,
    targetName,
    fromId: fromId ?? null,
    toId: m.id,
    fromName: nameOf(fromId),
    toName: m.nameZh,
  });
  const bad = (allowed: string[]) =>
    !allowed.includes(m.category) ? fail('MATERIAL_MISMATCH', `「${m.nameZh}」不適用於此表面`) : null;
  const room = lv.rooms.find((r) => r.id === id);
  const changes: Change[] = [];
  if (room) {
    const label = room.label ?? room.id;
    if (!surface || surface === 'floor') {
      const b = bad(FLOOR_CATS);
      if (b) return b;
      changes.push(mk({ kind: 'floor', roomId: room.id }, `${label}地板`, room.floorMaterialId));
    } else if (surface === 'ceiling') {
      const b = bad(CEILING_CATS);
      if (b) return b;
      changes.push(mk({ kind: 'ceiling', roomId: room.id }, `${label}天花`, room.ceilingMaterialId));
    } else if (surface === 'walls') {
      const b = bad(WALL_CATS);
      if (b) return b;
      const g = roomGeometry(lv, room);
      const seen = new Set<string>();
      for (const f of g ? roomWallFaces(lv, g) : []) {
        const key = `${f.wallId}:${f.side}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const w = lv.walls.find((x) => x.id === f.wallId)!;
        const from = f.side === 'A' ? w.materialId : (w.materialIdB ?? w.materialId);
        changes.push(mk({ kind: 'wall', id: w.id, side: f.side }, `${label}・${wallName(lv, w)}`, from));
      }
    } else return fail('SURFACE_INVALID', `房間不支援 surface=${surface}`);
  } else {
    const w = lv.walls.find((x) => x.id === id);
    const o = lv.objects.find((x) => x.id === id);
    if (w) {
      const b = bad(WALL_CATS);
      if (b) return b;
      const side =
        surface === 'wall_a'
          ? 'A'
          : surface === 'wall_b'
            ? 'B'
            : surface === 'both' || !surface
              ? 'both'
              : null;
      if (!side) return fail('SURFACE_INVALID', `牆不支援 surface=${surface}`);
      changes.push(
        mk(
          { kind: 'wall', id: w.id, side },
          wallName(lv, w),
          side === 'B' ? (w.materialIdB ?? w.materialId) : w.materialId,
        ),
      );
    } else if (o) {
      const b = bad(OBJECT_CATS);
      if (b) return b;
      const slot = ctx.catalog.get(o.catalogId)?.materialSlots.find((s) => s.swappable);
      if (!slot) return fail('NO_SLOT', `「${objectName(ctx, o)}」沒有可更換的材質`);
      changes.push(
        mk(
          { kind: 'object', id: o.id, slot: slot.name },
          objectName(ctx, o),
          o.materialOverrides?.[slot.name] ?? slot.defaultMaterialId,
        ),
      );
    } else return fail('TARGET_NOT_FOUND', `找不到 ${id}`);
  }
  const effective = changes.filter((c) => c.kind === 'material' && c.fromId !== c.toId);
  return {
    ok: true,
    proposal: {
      id: '',
      tool: 'set_material',
      args: a,
      changes: effective,
      warnings: effective.length ? [] : ['材質已經是這個，不需要變更'],
    },
  };
}

/** 靠牆擺放的大型家具（目錄 id 前綴或收納類） */
const WALL_HUGGERS = ['sofa_', 'bed_', 'tvstand_', 'cabinet_', 'desk_', 'shelf_', 'counter_', 'fridge_'];

/**
 * 配置建議（確定性演算法）：房內未鎖定、未指定保留的大型家具，若背面離最近牆面 > 150 mm，
 * 提案讓它背靠最近的牆（正面朝房內），跳過會造成重疊的移動；最後回報走道檢查結果。
 */
function suggestLayout(ctx: AssistantCtx, a: Record<string, unknown>): ResolveResult {
  const lv = ctx.level;
  const room = lv.rooms.find((r) => r.id === a.room_id);
  const g = room && roomGeometry(lv, room);
  if (!room || !g) return fail('ROOM_NOT_FOUND', `找不到房間 ${String(a.room_id)}`);
  const cons = (a.constraints ?? {}) as { min_walkway_mm?: number; keep_ids?: string[] };
  const keep = new Set(cons.keep_ids ?? []);
  const faces = roomWallFaces(lv, g);
  const changes: Change[] = [];
  let work: AssistantCtx = ctx;
  for (const o of lv.objects) {
    if (o.locked || keep.has(o.id) || roomOfObject(ctx, o) !== room.id) continue;
    const e = ctx.catalog.get(o.catalogId);
    if (
      !e ||
      e.anchor !== 'floor' ||
      !(WALL_HUGGERS.some((p) => o.catalogId.startsWith(p)) || e.category === 'storage')
    )
      continue;
    const d = dimsOf(ctx, o);
    const p: Vec2 = [o.position[0], o.position[2]];
    // 背面中心 = 位置 − front × 深/2
    const back: Vec2 = [p[0] - Math.sin(o.rotationY) * (d.d / 2), p[1] - Math.cos(o.rotationY) * (d.d / 2)];
    let best: { wallId: string; dist: number } | null = null;
    for (const f of faces) {
      const w = lv.walls.find((x) => x.id === f.wallId)!;
      const L = wallLength(w) || 1;
      const u = ((back[0] - w.a[0]) * (w.b[0] - w.a[0]) + (back[1] - w.a[1]) * (w.b[1] - w.a[1])) / L;
      if (u < 0 || u > L) continue;
      const dist =
        Math.abs(((back[0] - w.a[0]) * -(w.b[1] - w.a[1]) + (back[1] - w.a[1]) * (w.b[0] - w.a[0])) / L) -
        w.thickness / 2;
      if (!best || dist < best.dist) best = { wallId: w.id, dist };
    }
    if (!best || best.dist <= 150) continue;
    const w = lv.walls.find((x) => x.id === best!.wallId)!;
    const pose = againstWall(work, d, w, centroid(g.floor), null, 10, g.centerline);
    const u =
      ((p[0] - w.a[0]) * (w.b[0] - w.a[0]) + (p[1] - w.a[1]) * (w.b[1] - w.a[1])) / (wallLength(w) || 1);
    const pose2 = againstWall(work, d, w, centroid(g.floor), u, 10, g.centerline);
    const chosen = collisionsAfter(work, o, pose2).length === 0 ? pose2 : pose;
    if (collisionsAfter(work, o, chosen).length) continue;
    const ch = moveChange(work, o, chosen);
    changes.push(ch);
    work = { ...work, level: applyMoveToLevel(work.level, ch) };
  }
  const clearance = checkClearance(work, room.id, cons.min_walkway_mm);
  const warnings = (
    clearance.issues as { kind: string; aName: string; bName?: string; gapMm?: number }[]
  ).map((i) =>
    i.kind === 'narrow'
      ? `「${i.aName}」與「${i.bName}」之間只有 ${i.gapMm} mm`
      : i.kind === 'door_blocked'
        ? `「${i.aName}」擋住門口`
        : i.kind === 'in_wall'
          ? `「${i.aName}」穿入牆體`
          : `「${i.aName}」與「${i.bName}」重疊`,
  );
  if (!changes.length) warnings.unshift('目前的大型家具都已靠牆，沒有需要移動的項目');
  return { ok: true, proposal: { id: '', tool: 'suggest_layout', args: a, changes, warnings } };
}

function applyMoveToLevel(level: Level, ch: Change): Level {
  if (ch.kind !== 'move') return level;
  return {
    ...level,
    objects: level.objects.map((o) =>
      o.id === ch.objectId ? { ...o, position: ch.position, rotationY: ch.rotationY } : o,
    ),
  };
}

/** 確認後套用：整個提案＝一個 Command（一次 Undo 還原） */
export function proposalCommand(levelId: string, proposal: Pick<Proposal, 'id' | 'changes'>): Command {
  const cmds: Command[] = proposal.changes.map((c) => {
    switch (c.kind) {
      case 'move':
        return transformObject(levelId, c.objectId, { position: c.position, rotationY: c.rotationY });
      case 'resize_wall':
        return resizeWall(levelId, c.wallId, c.toMm, c.keep);
      case 'add':
        return addObject(levelId, c.object);
      case 'material':
        return setMaterial(levelId, c.target, c.toId);
    }
  });
  return {
    id: `assistant_${proposal.id}`,
    label: 'command.assistantProposal',
    do: (d) => {
      for (const c of cmds) c.do(d);
    },
  };
}

/** 預覽用：套用提案後的場景（不進歷史、不改原場景） */
export function previewScene(scene: Scene, levelId: string, proposals: readonly Proposal[]): Scene {
  let s = scene;
  for (const p of proposals) s = execCommand(s, { past: [], future: [] }, proposalCommand(levelId, p)).scene;
  return s;
}

/** 差異的純文字描述（繁中；評測/記錄用，UI 以 i18n 呈現） */
export function describeChange(c: Change): string {
  switch (c.kind) {
    case 'move':
      return c.from.rotationDeg !== c.to.rotationDeg && c.from.x === c.to.x && c.from.z === c.to.z
        ? `旋轉「${c.name}」：${c.from.rotationDeg}° → ${c.to.rotationDeg}°`
        : `移動「${c.name}」：(${c.from.x}, ${c.from.z}) → (${c.to.x}, ${c.to.z}) mm` +
            (c.from.rotationDeg !== c.to.rotationDeg
              ? `，方向 ${c.from.rotationDeg}° → ${c.to.rotationDeg}°`
              : '');
    case 'resize_wall':
      return `「${c.name}」長度：${c.fromMm} → ${c.toMm} mm`;
    case 'add':
      return `新增「${c.name}」到「${c.roomLabel ?? c.roomId}」(${c.object.position[0]}, ${c.object.position[2]}) mm`;
    case 'material':
      return `「${c.targetName}」材質：${c.fromName ?? '預設'} → ${c.toName}`;
  }
}
