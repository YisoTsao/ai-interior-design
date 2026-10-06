/**
 * 純影像運算（無 DOM / 無原生依賴），瀏覽器（G-buffer 邊緣）與後端（結構驗證、遮罩、合成、mock provider）共用。
 * 所有函式確定性：同輸入 → 同輸出（05 §5、ADR-012 的 break_structure 定義依賴這點）。
 */

/** 8-bit RGBA，列優先 */
export interface RGBA {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
/** 單通道 8-bit；遮罩以 0/1 表示 */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export const rgba = (width: number, height: number, data?: Uint8Array): RGBA => ({
  width,
  height,
  data: data ?? new Uint8Array(width * height * 4),
});
export const gray = (width: number, height: number, data?: Uint8Array): Gray => ({
  width,
  height,
  data: data ?? new Uint8Array(width * height),
});

/** 結構驗證容許誤差 τ（px）＝短邊 × ratio（預設 1.2%，models.yaml） */
export const tauPx = (w: number, h: number, ratio = 0.012) => Math.max(1, Math.round(Math.min(w, h) * ratio));

export function toGray(img: RGBA): Gray {
  const g = gray(img.width, img.height);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4)
    g.data[i] = Math.round(0.299 * img.data[j]! + 0.587 * img.data[j + 1]! + 0.114 * img.data[j + 2]!);
  return g;
}

/** 雙線性縮放（輸出圖縮放到 G-buffer 尺寸，05 §5-1） */
export function resize(img: RGBA, w: number, h: number): RGBA {
  if (img.width === w && img.height === h) return rgba(w, h, new Uint8Array(img.data));
  const out = rgba(w, h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(img.height - 1, Math.floor(fy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(img.width - 1, Math.floor(fx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const p = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + c]!;
        const top = p(y0, x0) * (1 - tx) + p(y0, x1) * tx;
        const bot = p(y1, x0) * (1 - tx) + p(y1, x1) * tx;
        out.data[(y * w + x) * 4 + c] = Math.round(top * (1 - ty) + bot * ty);
      }
    }
  }
  return out;
}

function blur5(g: Gray): Float32Array {
  // 5×5 高斯（σ≈1.4），邊界複製
  const k = [2, 4, 5, 4, 2, 4, 9, 12, 9, 4, 5, 12, 15, 12, 5, 4, 9, 12, 9, 4, 2, 4, 5, 4, 2];
  const { width: w, height: h, data } = g;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += data[yy * w + xx]! * k[(dy + 2) * 5 + dx + 2]!;
        }
      out[y * w + x] = s / 159;
    }
  return out;
}

/**
 * Canny 邊緣（固定門檻，05 §5-2）：高斯 → Sobel → 非極大值抑制 → 雙門檻遲滯。回傳 0/1 遮罩。
 * 門檻 10/25（Sobel 幅值）：5×5 高斯後，亮度差 ≥ 20 的 clay 分界都能偵測（單元測試以合成 G-buffer 驗證）。
 */
export function canny(g: Gray, low = 10, high = 25): Gray {
  const { width: w, height: h } = g;
  const b = blur5(g);
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = (dx: number, dy: number) => b[(y + dy) * w + x + dx]!;
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      mag[y * w + x] = Math.hypot(gx, gy);
      const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      dir[y * w + x] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  const nms = new Float32Array(w * h);
  const off = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ] as const;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const [dx, dy] = off[dir[i]!]!;
      const m = mag[i]!;
      if (m >= mag[(y + dy) * w + x + dx]! && m >= mag[(y - dy) * w + x - dx]!) nms[i] = m;
    }
  const out = gray(w, h);
  const stack: number[] = [];
  for (let i = 0; i < nms.length; i++)
    if (nms[i]! >= high && !out.data[i]) {
      out.data[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % w;
        const jy = (j - jx) / w;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = jx + dx;
            const yy = jy + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx;
            if (!out.data[k] && nms[k]! >= low) {
              out.data[k] = 1;
              stack.push(k);
            }
          }
      }
    }
  return out;
}

/** 方形膨脹（半徑 r px，可分離：先水平再垂直） */
export function dilate(m: Gray, r: number): Gray {
  if (r <= 0) return gray(m.width, m.height, new Uint8Array(m.data));
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    // 兩次掃描：左→右、右→左 記錄最近的 1
    let prev = -Infinity;
    for (let x = 0; x < w; x++) {
      if (m.data[y * w + x]) prev = x;
      if (x - prev <= r) tmp[y * w + x] = 1;
    }
    let next = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (m.data[y * w + x]) next = x;
      if (next - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = gray(w, h);
  for (let x = 0; x < w; x++) {
    let prev = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) prev = y;
      if (y - prev <= r) out.data[y * w + x] = 1;
    }
    let next = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) next = y;
      if (next - y <= r) out.data[y * w + x] = 1;
    }
  }
  return out;
}

export const countOnes = (m: Gray) => m.data.reduce((a, v) => a + (v ? 1 : 0), 0);

/**
 * 結構保留率（05 §5-3）：G-buffer 結構邊緣 E_g 被「膨脹 τ 後的輸出邊緣 E_o」覆蓋的比例。
 * E_g 為空（全平面場景）時回 1。
 */
export function structureRecall(ref: Gray, out: Gray, tau: number): number {
  if (ref.width !== out.width || ref.height !== out.height) throw new Error('尺寸不一致');
  const d = dilate(out, tau);
  let total = 0;
  let hit = 0;
  for (let i = 0; i < ref.data.length; i++)
    if (ref.data[i]) {
      total++;
      if (d.data[i]) hit++;
    }
  return total === 0 ? 1 : hit / total;
}

// ── objectId ─────────────────────────────────────────────────────

/** objectId 編碼：1..2^24-1 → RGB（0 保留給背景）。確定性、無抗鋸齒時可無損往返。 */
export const encodeId = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
export const decodeId = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

export function idAt(img: RGBA, i: number) {
  return decodeId(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
}

/** objectId 邊界：與右方或下方像素 id 不同即為邊緣 */
export function idEdges(ids: RGBA): Gray {
  const { width: w, height: h } = ids;
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = idAt(ids, i);
      if ((x + 1 < w && idAt(ids, i + 1) !== v) || (y + 1 < h && idAt(ids, i + w) !== v)) out.data[i] = 1;
    }
  return out;
}

/** 深度不連續：相鄰像素深度差 > threshold（0–255 灰階） */
export function depthEdges(depth: Gray, threshold = 6): Gray {
  const { width: w, height: h } = depth;
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = depth.data[i]!;
      if (
        (x + 1 < w && Math.abs(depth.data[i + 1]! - d) > threshold) ||
        (y + 1 < h && Math.abs(depth.data[i + w]! - d) > threshold)
      )
        out.data[i] = 1;
    }
  return out;
}

/** G-buffer 的結構邊緣圖＝objectId 邊界 ∪ 深度邊界（03 §6-5） */
export function structuralEdges(ids: RGBA, depth: Gray, depthThreshold = 6): Gray {
  const a = idEdges(ids);
  const b = depthEdges(depth, depthThreshold);
  for (let i = 0; i < a.data.length; i++) a.data[i] = a.data[i] || b.data[i] ? 1 : 0;
  return a;
}

// ── 遮罩與合成 ────────────────────────────────────────────────────

/** 由 objectId 圖取出所選物件的區域（1＝要改），再膨脹 px（05 §3：2–4 px） */
export function maskFromIds(ids: RGBA, selected: readonly number[], dilatePx = 3): Gray {
  const set = new Set(selected);
  const m = gray(ids.width, ids.height);
  for (let i = 0; i < m.data.length; i++) if (set.has(idAt(ids, i))) m.data[i] = 1;
  return dilate(m, dilatePx);
}

/** GPT Image 遮罩格式：透明（alpha 0）＝要改；其餘不透明（B6.2-2） */
export function maskToAlpha(m: Gray): RGBA {
  const out = rgba(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) {
    out.data[i * 4 + 3] = m.data[i] ? 0 : 255;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
  }
  return out;
}

/**
 * 遮罩外像素還原（B6.2-3）：遮罩外逐位元取原圖，遮罩內取編輯結果。
 * edited 尺寸不同時先縮放到原圖尺寸。
 */
export function compositeOutsideMask(original: RGBA, edited: RGBA, mask: Gray): RGBA {
  if (mask.width !== original.width || mask.height !== original.height)
    throw new Error('遮罩與原圖尺寸不一致');
  const e = resize(edited, original.width, original.height);
  const out = rgba(original.width, original.height, new Uint8Array(original.data));
  for (let i = 0; i < mask.data.length; i++)
    if (mask.data[i]) for (let c = 0; c < 4; c++) out.data[i * 4 + c] = e.data[i * 4 + c]!;
  return out;
}

// ── mock provider 用的確定性濾鏡（05 §8、ADR-012 §6） ─────────────

/** 確定性雜訊（LCG），振幅 ±amp；alpha 不變 */
export function deterministicNoise(img: RGBA, seed = 1, amp = 6): RGBA {
  const out = rgba(img.width, img.height, new Uint8Array(img.data));
  let s = seed >>> 0 || 1;
  for (let i = 0; i < out.data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = ((s >>> 24) / 255 - 0.5) * 2 * amp;
    for (let c = 0; c < 3; c++)
      out.data[i + c] = Math.max(0, Math.min(255, Math.round(img.data[i + c]! + n)));
  }
  return out;
}

/** 整張圖平移（空出的區域複製邊界像素） */
export function shift(img: RGBA, dx: number, dy: number): RGBA {
  const { width: w, height: h } = img;
  const out = rgba(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - dx));
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      for (let c = 0; c < 4; c++) out.data[(y * w + x) * 4 + c] = img.data[(sy * w + sx) * 4 + c]!;
    }
  return out;
}

/** 面積最大的非背景 objectId 區塊（id≠0） */
export function largestRegion(ids: RGBA): number | null {
  const counts = new Map<number, number>();
  for (let i = 0; i < ids.width * ids.height; i++) {
    const v = idAt(ids, i);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: number | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n || (c === n && best !== null && k < best)) [best, n] = [k, c];
  return best;
}

/** 把 objectId 為 id 的區塊填成周圍（膨脹 2px 的外環）平均色 */
export function fillRegion(img: RGBA, ids: RGBA, id: number): RGBA {
  const inside = gray(ids.width, ids.height);
  for (let i = 0; i < inside.data.length; i++) if (idAt(ids, i) === id) inside.data[i] = 1;
  const ring = dilate(inside, 2);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < ring.data.length; i++)
    if (ring.data[i] && !inside.data[i]) {
      for (let c = 0; c < 3; c++) sum[c]! += img.data[i * 4 + c]!;
      n++;
    }
  const mean = sum.map((v) => (n ? Math.round(v / n) : 128));
  const out = rgba(img.width, img.height, new Uint8Array(img.data));
  for (let i = 0; i < inside.data.length; i++)
    if (inside.data[i]) for (let c = 0; c < 3; c++) out.data[i * 4 + c] = mean[c]!;
  return out;
}

/** 可見浮水印：對角斜紋（未通過驗證預覽、免費方案，B6.2-6） */
export function watermark(img: RGBA, strength = 0.35): RGBA {
  const out = rgba(img.width, img.height, new Uint8Array(img.data));
  const period = Math.max(24, Math.round(Math.min(img.width, img.height) / 8));
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if ((x + y) % period >= period / 4) continue;
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++)
        out.data[i + c] = Math.round(out.data[i + c]! * (1 - strength) + 255 * strength);
    }
  return out;
}

/** 0/1 遮罩 → 可視的黑白 RGBA（邊緣圖存檔用） */
export function maskToRGBA(m: Gray): RGBA {
  const out = rgba(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] ? 255 : 0;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** 黑白 RGBA → 0/1 遮罩（讀回邊緣圖） */
export function rgbaToMask(img: RGBA, threshold = 128): Gray {
  const g = toGray(img);
  for (let i = 0; i < g.data.length; i++) g.data[i] = g.data[i]! >= threshold ? 1 : 0;
  return g;
}

/** 單通道灰階 → RGBA（深度圖存檔用） */
export function grayToRGBA(g: Gray): RGBA {
  const out = rgba(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g.data[i]!;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** 遮罩最近鄰縮放（保持 0/1；G-buffer 尺寸的遮罩 → 效果圖尺寸） */
export function resizeMask(m: Gray, w: number, h: number): Gray {
  const out = gray(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / w));
      out.data[y * w + x] = m.data[sy * m.width + sx]!;
    }
  }
  return out;
}
