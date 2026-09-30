/**
 * 最小影像運算集（取代 cv-service 的 OpenCV 用法）：灰階、模糊、Otsu、自適應門檻、
 * 二值形態學、連通元件、精確歐氏距離轉換、輪廓追蹤。二值影像以 0／255 表示。
 * 純函式、不依賴 DOM，可在瀏覽器 Web Worker 與 Node 測試中執行。
 */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export const gray = (width: number, height: number, data?: Uint8Array): Gray => ({
  width,
  height,
  data: data ?? new Uint8Array(width * height),
});

/** RGBA → 灰階（ITU-R BT.601，與 PIL convert('L') 相同權重）；透明像素視為白色 */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Gray {
  const out = gray(width, height);
  for (let i = 0, j = 0; j < out.data.length; i += 4, j++) {
    const a = rgba[i + 3] / 255;
    const l = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    out.data[j] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

/** 3×3 高斯模糊（[1 2 1]/4 分離式；邊界複製） */
export function blur3(g: Gray): Gray {
  const { width: w, height: h, data } = g;
  const tmp = new Float32Array(w * h);
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = data[i - (x > 0 ? 1 : 0)];
      const r = data[i + (x < w - 1 ? 1 : 0)];
      tmp[i] = (l + 2 * data[i] + r) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = tmp[i - (y > 0 ? w : 0)];
      const d = tmp[i + (y < h - 1 ? w : 0)];
      out.data[i] = Math.round((u + 2 * tmp[i] + d) / 4);
    }
  return out;
}

/** Otsu 門檻（類間變異數最大） */
export function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** 反相二值化：v ≤ t → 255（墨跡），否則 0（同 cv2.THRESH_BINARY_INV） */
export function thresholdInv(g: Gray, t: number): Gray {
  const out = gray(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) out.data[i] = g.data[i] > t ? 0 : 255;
  return out;
}

/** 積分影像（(w+1)×(h+1)） */
function integral(g: Gray, binary = false): Float64Array {
  const { width: w, height: h, data } = g;
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += binary ? (data[y * w + x] ? 1 : 0) : data[y * w + x];
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
    }
  }
  return s;
}
const boxSum = (s: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number) =>
  s[(y1 + 1) * (w + 1) + x1 + 1] -
  s[y0 * (w + 1) + x1 + 1] -
  s[(y1 + 1) * (w + 1) + x0] +
  s[y0 * (w + 1) + x0];

/** 局部自適應門檻（區塊平均 − C；cv2 的高斯權重以方框平均近似）：較深者為墨跡 */
export function adaptiveInv(g: Gray, block: number, C: number): Gray {
  const { width: w, height: h } = g;
  const s = integral(g);
  const r = Math.floor(block / 2);
  const out = gray(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const mean = boxSum(s, w, x0, y0, x1, y1) / ((x1 - x0 + 1) * (y1 - y0 + 1));
      out.data[y * w + x] = g.data[y * w + x] > mean - C ? 0 : 255;
    }
  }
  return out;
}

export const or = (a: Gray, b: Gray): Gray => {
  const out = gray(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] || b.data[i] ? 255 : 0;
  return out;
};
export const andNot = (a: Gray, b: Gray): Gray => {
  const out = gray(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] && !b.data[i] ? 255 : 0;
  return out;
};
export const not = (a: Gray): Gray => {
  const out = gray(a.width, a.height);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] ? 0 : 255;
  return out;
};
export const count = (m: Gray) => {
  let n = 0;
  for (const v of m.data) if (v) n++;
  return n;
};
export const clone = (m: Gray): Gray => gray(m.width, m.height, m.data.slice());

/**
 * 矩形結構元素的侵蝕／膨脹（錨點置中，同 cv2：偏移 [−⌊k/2⌋, k−1−⌊k/2⌋]；影像外不影響結果）。
 * 以積分影像計算視窗內前景數：侵蝕＝全滿、膨脹＝至少一個。
 */
function morph(m: Gray, kw: number, kh: number, erode: boolean): Gray {
  const { width: w, height: h } = m;
  const s = integral(m, true);
  const lx = Math.floor(kw / 2);
  const ly = Math.floor(kh / 2);
  const out = gray(w, h);
  for (let y = 0; y < h; y++) {
    // 膨脹用反射的視窗（dst(x) = max src(x − k)）
    const y0 = Math.max(0, erode ? y - ly : y - (kh - 1 - ly));
    const y1 = Math.min(h - 1, erode ? y + (kh - 1 - ly) : y + ly);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, erode ? x - lx : x - (kw - 1 - lx));
      const x1 = Math.min(w - 1, erode ? x + (kw - 1 - lx) : x + lx);
      const n = boxSum(s, w, x0, y0, x1, y1);
      out.data[y * w + x] = erode ? (n === (x1 - x0 + 1) * (y1 - y0 + 1) ? 255 : 0) : n > 0 ? 255 : 0;
    }
  }
  return out;
}
export const erode = (m: Gray, kw: number, kh = kw) => morph(m, kw, kh, true);
export const dilate = (m: Gray, kw: number, kh = kw) => morph(m, kw, kh, false);
export const open = (m: Gray, k: number) => dilate(erode(m, k), k);
export const close = (m: Gray, k: number) => erode(dilate(m, k), k);

export interface CompStats {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}
/** 連通元件（4／8 連通）：labels 0＝背景；stats[0] 為背景佔位 */
export function components(m: Gray, conn: 4 | 8 = 8): { labels: Int32Array; stats: CompStats[] } {
  const { width: w, height: h, data } = m;
  const labels = new Int32Array(w * h);
  const stats: CompStats[] = [{ x: 0, y: 0, w: 0, h: 0, area: 0 }];
  const stack = new Int32Array(w * h);
  const nb8 = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1];
  const nbN = conn === 8 ? 8 : 4;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (!data[i] || labels[i]) continue;
    n++;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let top = 0;
    stack[top++] = i;
    labels[i] = n;
    while (top) {
      const p = stack[--top];
      const px = p % w;
      const py = (p - px) / w;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let k = 0; k < nbN; k++) {
        const qx = px + nb8[k * 2];
        const qy = py + nb8[k * 2 + 1];
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (data[q] && !labels[q]) {
          labels[q] = n;
          stack[top++] = q;
        }
      }
    }
    stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { labels, stats };
}

/** 只保留外框長邊 ≥ minLen 的元件（去掉文字、雜點） */
export function keepLong(m: Gray, minLen: number): Gray {
  const { labels, stats } = components(m, 8);
  const keep = stats.map((s, i) => i > 0 && Math.max(s.w, s.h) >= minLen);
  const out = gray(m.width, m.height);
  for (let i = 0; i < labels.length; i++) if (keep[labels[i]]) out.data[i] = 255;
  return out;
}

/** 精確歐氏距離轉換（Felzenszwalb–Huttenlocher）：前景像素到最近背景的距離 */
export function distanceTransform(m: Gray): Float32Array {
  const { width: w, height: h } = m;
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = m.data[i] ? INF : 0;
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** 在二值影像上畫粗線段（沿線蓋正方形印章） */
export function drawLine(
  m: Gray,
  a: readonly [number, number],
  b: readonly [number, number],
  thickness: number,
) {
  const r = Math.max(0, Math.floor(thickness / 2));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L));
  for (let i = 0; i <= n; i++) {
    const cx = Math.round(a[0] + ((b[0] - a[0]) * i) / n);
    const cy = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < m.width && y < m.height) m.data[y * m.width + x] = 255;
  }
}

/** 單一元件的外輪廓（Moore 鄰域追蹤；回傳像素中心座標，順時針） */
export function traceContour(
  labels: Int32Array,
  w: number,
  h: number,
  id: number,
  start: number,
): [number, number][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const;
  const sx = start % w;
  const sy = (start - sx) / w;
  const out: [number, number][] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let dir = 7; // 從起點（最上最左）的上方開始
  const maxSteps = w * h * 4;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // 從上一個方向的左後方開始順時針找
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (inside(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx && cy === sy)) break;
    out.push([cx, cy]);
  }
  return out;
}

/** Douglas–Peucker 折線簡化（封閉多邊形） */
export function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 4) return pts;
  const dp = (a: number, b: number, keep: Uint8Array) => {
    let best = -1;
    let bi = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps && bi > 0) {
      keep[bi] = 1;
      dp(a, bi, keep);
      dp(bi, b, keep);
    }
  };
  // 封閉：以距離起點最遠的點切成兩段
  let far = 0;
  let fd = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  dp(0, far, keep);
  const ring = [...pts, pts[0]];
  const keep2 = new Uint8Array(ring.length);
  const sub = (a: number, b: number) => {
    let best = -1;
    let bi = -1;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - ring[i][1]) - (ax - ring[i][0]) * (by - ay)) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps && bi > 0) {
      keep2[bi] = 1;
      sub(a, bi);
      sub(bi, b);
    }
  };
  sub(far, ring.length - 1);
  return pts.filter((_, i) => keep[i] || (i >= far && keep2[i]) || i === far);
}
