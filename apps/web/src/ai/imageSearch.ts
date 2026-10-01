/**
 * 以圖找物（FE-AST-09）：瀏覽器內的影像描述子——前景色彩直方圖（RGB 各 4 階，64 格）＋前景外框長寬比。
 * 照片的前景以「與邊框平均色差異大」判定；資產縮圖（透明背景）以 alpha 判定。
 * 相似度＝0.65×直方圖交集＋0.35×比例相似；沒有 AI 模型時的實用近似（可之後替換為影像嵌入向量）。
 */
export interface ImageDescriptor {
  hist: Float32Array;
  aspect: number;
}

export function describe(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  mode: 'alpha' | 'border' = 'border',
): ImageDescriptor {
  let br = 0;
  let bg = 0;
  let bb = 0;
  let bn = 0;
  if (mode === 'border') {
    const add = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      br += rgba[i]!;
      bg += rgba[i + 1]!;
      bb += rgba[i + 2]!;
      bn++;
    };
    for (let x = 0; x < w; x += 2) {
      add(x, 0);
      add(x, h - 1);
    }
    for (let y = 0; y < h; y += 2) {
      add(0, y);
      add(w - 1, y);
    }
    br /= bn;
    bg /= bn;
    bb /= bn;
  }
  const hist = new Float32Array(64);
  let n = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const fg =
        mode === 'alpha' ? rgba[i + 3]! > 32 : Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > 60;
      if (!fg) continue;
      hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)]! += 1;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (n) for (let k = 0; k < 64; k++) hist[k]! /= n;
  const aspect = x1 >= x0 && y1 >= y0 ? (x1 - x0 + 1) / (y1 - y0 + 1) : w / h;
  return { hist, aspect };
}

export function similarity(a: ImageDescriptor, b: ImageDescriptor): number {
  let inter = 0;
  for (let k = 0; k < 64; k++) inter += Math.min(a.hist[k]!, b.hist[k]!);
  const shape = Math.exp(-Math.abs(Math.log(Math.max(1e-3, a.aspect) / Math.max(1e-3, b.aspect))));
  return 0.65 * inter + 0.35 * shape;
}

/** 依相似度排序（高 → 低） */
export function rank<T>(query: ImageDescriptor, items: readonly { item: T; d: ImageDescriptor }[], top = 12) {
  return items
    .map((x) => ({ item: x.item, score: similarity(query, x.d) }))
    .sort((p, q) => q.score - p.score)
    .slice(0, top);
}
