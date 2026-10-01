import { PlanParseError, type OpeningOut, type PlanResult, type Vec2, type WallOut } from './types.js';

/**
 * 手機 LiDAR 掃描匯入（FE-MOB-04）：Apple RoomPlan 的 CapturedRoom JSON（iOS 16+，Codable 匯出）。
 * walls／doors／windows／openings 各有 dimensions [寬, 高, 深]（公尺）與 transform（4×4，欄主序；
 * 可能是 16 個數或 4 組 4 個數）。牆的局部 X 軸沿牆。門窗對應到最近且平行的牆。輸出 PlanResult（mm，尺度已知）。
 */
type Surface = { dimensions?: number[]; transform?: number[] | number[][] };
const flat = (t: Surface['transform']): number[] | null => {
  if (!t) return null;
  const f = (Array.isArray(t[0]) ? (t as number[][]).flat() : (t as number[])).map(Number);
  return f.length === 16 && f.every(Number.isFinite) ? f : null;
};

export function isRoomPlanJson(text: string): boolean {
  try {
    const o = JSON.parse(text) as { walls?: unknown };
    return Array.isArray(o.walls);
  } catch {
    return false;
  }
}

export function recognizeRoomPlan(text: string): PlanResult {
  let o: { walls?: Surface[]; doors?: Surface[]; windows?: Surface[]; openings?: Surface[] };
  try {
    o = JSON.parse(text);
  } catch {
    throw new PlanParseError('PARSE_FAILED', 'JSON 格式錯誤');
  }
  if (!Array.isArray(o.walls) || !o.walls.length)
    throw new PlanParseError('UPLOAD_REJECTED', '不是 RoomPlan 掃描檔（缺少 walls）');
  const mm = (v: number) => Math.round(v * 1000);
  type W = { a: Vec2; b: Vec2; L: number; u: Vec2; y0: number };
  const ws: W[] = [];
  for (const w of o.walls) {
    const m = flat(w.transform);
    const d = w.dimensions ?? [];
    if (!m || !(d[0]! > 0.05)) continue;
    const c: Vec2 = [m[12]!, m[14]!];
    const ul = Math.hypot(m[0]!, m[2]!) || 1;
    const u: Vec2 = [m[0]! / ul, m[2]! / ul];
    const L = d[0]!;
    ws.push({
      a: [c[0] - (u[0] * L) / 2, c[1] - (u[1] * L) / 2],
      b: [c[0] + (u[0] * L) / 2, c[1] + (u[1] * L) / 2],
      L,
      u,
      y0: m[13]! - (d[1] ?? 2.4) / 2,
    });
  }
  if (!ws.length) throw new PlanParseError('PARSE_FAILED', '掃描中沒有可用的牆');
  const floorY = Math.min(...ws.map((w) => w.y0));
  // 原點平移到外框左上角（與其他匯入一致）
  const x0 = Math.min(...ws.flatMap((w) => [w.a[0], w.b[0]]));
  const z0 = Math.min(...ws.flatMap((w) => [w.a[1], w.b[1]]));
  const P = (p: Vec2): Vec2 => [mm(p[0] - x0), mm(p[1] - z0)];
  const walls: WallOut[] = ws.map((w, i) => ({
    id: `w_${i}`,
    a: P(w.a),
    b: P(w.b),
    thickness: 150,
    confidence: 0.9,
  }));
  const openings: OpeningOut[] = [];
  const add = (list: Surface[] | undefined, type: OpeningOut['type']) => {
    for (const s of list ?? []) {
      const m = flat(s.transform);
      const d = s.dimensions ?? [];
      if (!m || !(d[0]! > 0.2)) continue;
      const c: Vec2 = [m[12]!, m[14]!];
      let best: { i: number; t: number; dist: number } | null = null;
      ws.forEach((w, i) => {
        const t = (c[0] - w.a[0]) * w.u[0] + (c[1] - w.a[1]) * w.u[1];
        const px = w.a[0] + w.u[0] * t;
        const pz = w.a[1] + w.u[1] * t;
        const dist = Math.hypot(c[0] - px, c[1] - pz);
        if (t < -0.1 || t > w.L + 0.1 || dist > 0.35) return;
        if (!best || dist < best.dist) best = { i, t, dist };
      });
      if (!best) continue;
      const { i, t } = best as { i: number; t: number };
      const w = ws[i]!;
      const width = Math.min(d[0]!, w.L);
      const h = d[1] ?? (type === 'window' ? 1.2 : 2.1);
      const sill = Math.max(0, m[13]! - h / 2 - floorY);
      openings.push({
        id: `op_${openings.length}`,
        wallId: walls[i]!.id,
        type,
        offset: mm(Math.max(0, Math.min(w.L - width, t - width / 2))),
        width: mm(width),
        height: mm(h),
        sill: type === 'door' || type === 'passage' ? 0 : mm(sill),
        confidence: 0.85,
      });
    }
  };
  add(o.doors, 'door');
  add(o.windows, 'window');
  add(o.openings, 'passage');
  return {
    source: 'vector',
    units: 'mm',
    scale: { mmPerPx: 1, method: 'dxf_units', confidence: 1 },
    walls,
    openings,
    rooms: [],
    labels: [],
    image: null,
    warnings: [{ code: 'ROOMPLAN', message: 'RoomPlan 掃描：牆厚以 150 mm 估計，請確認' }],
  };
}
