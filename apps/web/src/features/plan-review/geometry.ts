import type { ImportLabel, ImportOpening, ImportWall } from '@interiorai/app-state';
import type { Schemas } from '@interiorai/api-client';

export type PlanResult = Schemas['PlanResult'];
type P = [number, number];

/** 低信心門檻（B6.5-2〔假設〕）：低於此值在校正模式紅框高亮、列入待確認 */
export const LOW_CONFIDENCE = 0.6;

/**
 * PlanResult 座標（units：mm 或 px）↔ 原圖像素：
 * 原圖 →（cv-service 轉正 rotationDeg）→ 轉正後影像 → 減去 originPx、乘上 mm/px → 結果座標。
 * 向量檔沒有底圖：影像座標＝結果座標。
 */
export function imageTransform(r: PlanResult) {
  const im = (r.image ?? null) as {
    width?: number;
    height?: number;
    rotationDeg?: number;
    originPx?: P;
  } | null;
  if (!im || r.source === 'vector')
    return { toImage: (p: P): P => p, fromImage: (p: P): P => p, hasImage: false };
  const k = r.units === 'mm' && r.scale.mmPerPx ? r.scale.mmPerPx : 1;
  const [ox, oy] = im.originPx ?? [0, 0];
  const cx = (im.width ?? 0) / 2;
  const cy = (im.height ?? 0) / 2;
  const t = ((im.rotationDeg ?? 0) * Math.PI) / 180;
  // OpenCV getRotationMatrix2D(angle) 以逆時針為正（影像 y 朝下）：轉正後＝R(t)·(原圖 − c) + c
  const rot = (x: number, y: number, a: number): P => [
    cx + (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a),
    cy - (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  ];
  return {
    hasImage: true,
    toImage: (p: P): P => rot(p[0] / k + ox, p[1] / k + oy, -t),
    fromImage: (p: P): P => {
      const [x, y] = rot(p[0], p[1], t);
      return [(x - ox) * k, (y - oy) * k];
    },
  };
}

/** 兩點校正：結果座標中兩點距離 d（單位＝units）＋實際長度 mm → 每單位 mm */
export const calibrate = (a: P, b: P, realMm: number) =>
  realMm / Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1]));

/** 預設每單位 mm：mm 單位＝1（DXF/OCR 尺度，仍需使用者確認）；px 單位＝null（必須校正） */
export const defaultMmPerUnit = (r: PlanResult) => (r.units === 'mm' ? 1 : null);

const snapOrtho = (a: P, b: P, tolDeg = 4): [P, P] => {
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const m = ((ang % 180) + 180) % 180;
  if (Math.min(m, 180 - m) <= tolDeg) {
    const y = (a[1] + b[1]) / 2;
    return [
      [a[0], y],
      [b[0], y],
    ];
  }
  if (Math.abs(m - 90) <= tolDeg) {
    const x = (a[0] + b[0]) / 2;
    return [
      [x, a[1]],
      [x, b[1]],
    ];
  }
  return [a, b];
};

/**
 * 校正後的 PlanResult → 匯入資料（mm）。移到原點附近、可選直角吸附、略過使用者刪除的元素；
 * 外框上的牆標為外牆；房名來自房間多邊形（VLM/OCR）與圖面文字。
 */
export function toImport(
  r: PlanResult,
  mmPerUnit: number,
  opts: { orthogonal: boolean; removed: ReadonlySet<string> },
): { walls: ImportWall[]; openings: ImportOpening[]; labels: ImportLabel[] } {
  const keep = r.walls.filter((w) => !opts.removed.has(w.id));
  const xs = keep.flatMap((w) => [w.a[0]!, w.b[0]!]);
  const ys = keep.flatMap((w) => [w.a[1]!, w.b[1]!]);
  const ox = Math.min(...xs);
  const oy = Math.min(...ys);
  const T = (p: number[]): P => [(p[0]! - ox) * mmPerUnit, (p[1]! - oy) * mmPerUnit];
  const [maxX, maxY] = T([Math.max(...xs), Math.max(...ys)]);
  const walls: ImportWall[] = keep.map((w) => {
    let a = T(w.a);
    let b = T(w.b);
    if (opts.orthogonal) [a, b] = snapOrtho(a, b);
    const t = w.thickness * mmPerUnit;
    const onEdge = (v: number, edge: number) => Math.abs(v - edge) <= t * 1.5;
    const exterior =
      (onEdge(a[0], 0) && onEdge(b[0], 0)) ||
      (onEdge(a[0], maxX) && onEdge(b[0], maxX)) ||
      (onEdge(a[1], 0) && onEdge(b[1], 0)) ||
      (onEdge(a[1], maxY) && onEdge(b[1], maxY));
    return { key: w.id, a, b, thickness: t, exterior };
  });
  joinEndpoints(walls);
  const openings: ImportOpening[] = r.openings
    .filter((o) => !opts.removed.has(o.id) && !opts.removed.has(o.wallId))
    .map((o) => ({
      wallKey: o.wallId,
      type: o.type,
      offset: o.offset * mmPerUnit,
      width: o.width * mmPerUnit,
      height: o.height ?? (o.type === 'window' ? 1200 : 2100),
      sill: o.sill ?? (o.type === 'window' ? 900 : 0),
      swing: (o as { swing?: 'left' | 'right' | 'none' | null }).swing ?? null,
    }));
  const labels: ImportLabel[] = [];
  for (const rm of r.rooms ?? []) {
    if (!rm.label || rm.polygon.length < 3) continue;
    const n = rm.polygon.length;
    const c = [rm.polygon.reduce((s, p) => s + p[0]! / n, 0), rm.polygon.reduce((s, p) => s + p[1]! / n, 0)];
    labels.push({ text: rm.label, position: T(c) });
  }
  for (const l of (r.labels ?? []) as { text: string; position: number[] }[])
    labels.push({ text: l.text, position: T(l.position) });
  return { walls, openings, labels };
}

/** 低信心元素（待確認清單） */
export function pending(r: PlanResult) {
  return [
    ...r.walls
      .filter((w) => w.confidence < LOW_CONFIDENCE)
      .map((w) => ({ id: w.id, kind: 'wall' as const, confidence: w.confidence })),
    ...r.openings
      .filter((o) => o.confidence < LOW_CONFIDENCE)
      .map((o) => ({ id: o.id, kind: o.type, confidence: o.confidence })),
  ];
}

/**
 * 接點修補：點陣辨識的牆端常差幾 mm 沒接上 → 房間無法封閉。
 * 每個端點若在（牆厚×1.5，至少 150 mm）內靠近另一道不平行牆的中心線，就投影到那條線上（L/T 接點）。
 */
export function joinEndpoints(walls: ImportWall[]) {
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      let best: { d: number; q: P } | null = null;
      for (const o of walls) {
        if (o === w) continue;
        const ux = o.b[0] - o.a[0];
        const uy = o.b[1] - o.a[1];
        const L = Math.hypot(ux, uy);
        if (L < 1) continue;
        const wx = w.b[0] - w.a[0];
        const wy = w.b[1] - w.a[1];
        const sin = Math.abs(ux * wy - uy * wx) / (L * (Math.hypot(wx, wy) || 1));
        if (sin < 0.5) continue; // 只接不平行的牆
        const t = ((p[0] - o.a[0]) * ux + (p[1] - o.a[1]) * uy) / (L * L);
        const tol = Math.max(150, Math.max(w.thickness, o.thickness) * 1.5);
        if (t * L < -tol || t * L > L + tol) continue;
        const q: P = [o.a[0] + ux * t, o.a[1] + uy * t];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= tol && (!best || d < best.d)) best = { d, q };
      }
      if (best) w[end] = [Math.round(best.q[0]), Math.round(best.q[1])];
    }
  }
}
