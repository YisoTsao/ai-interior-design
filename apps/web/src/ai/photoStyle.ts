/**
 * 照片換風格（FE-AI-01）的前端流程與「本機預覽」引擎。
 *
 * 真正的 AI 換風格（擴散模型、照片輸入）需要後端新端點與供應商金鑰（見 PROGRESS 阻礙表）；
 * 這裡提供 PhotoStyleProvider 介面＋瀏覽器內的預覽實作：在 Lab 色彩空間做 Reinhard 色彩轉移，
 * 把照片的色調、明暗、飽和度推向風格色盤，可指定遮罩只重繪局部（羽化邊緣）。
 * 不會改變家具與結構的形狀——介面上明確標示為「本機預覽（非 AI 生成）」。
 */

export const PHOTO_STYLES = ['nordic', 'japandi', 'industrial', 'modern', 'classic', 'boho'] as const;
export type PhotoStyle = (typeof PHOTO_STYLES)[number];

interface StyleSpec {
  /** 風格色盤（決定目標的 Lab 平均與標準差） */
  palette: string[];
  /** 0–1：轉移強度的基準 */
  strength: number;
  contrast: number;
  /** 正＝暖、負＝冷（b 通道位移） */
  warmth: number;
}
export const STYLE_SPECS: Record<PhotoStyle, StyleSpec> = {
  nordic: {
    palette: ['#f3f1ec', '#e2ddd3', '#c9b99f', '#a9a49b', '#7d8a7a'],
    strength: 0.7,
    contrast: 0.95,
    warmth: 1,
  },
  japandi: {
    palette: ['#efe8dc', '#d8cbb4', '#b39878', '#7b6650', '#4a4038'],
    strength: 0.75,
    contrast: 1,
    warmth: 3,
  },
  industrial: {
    palette: ['#2f3033', '#55575b', '#8a8580', '#a2623d', '#c9c3b8'],
    strength: 0.75,
    contrast: 1.12,
    warmth: -1,
  },
  modern: {
    palette: ['#f5f5f4', '#d4d4d2', '#9a9a98', '#3c3c3e', '#c7a76c'],
    strength: 0.65,
    contrast: 1.08,
    warmth: 0,
  },
  classic: {
    palette: ['#efe6d6', '#d9c7a5', '#a88a5f', '#6e5236', '#3d2c1f'],
    strength: 0.7,
    contrast: 1.05,
    warmth: 4,
  },
  boho: {
    palette: ['#efe2cf', '#d9a679', '#b5653f', '#7f8a58', '#4f3a2c'],
    strength: 0.75,
    contrast: 1,
    warmth: 5,
  },
};

/** 提示詞關鍵字 → 風格與調整（中英文）。沒有命中就沿用選擇的風格 */
const KEYWORDS: [RegExp, Partial<{ style: PhotoStyle; warmth: number; bright: number; contrast: number }>][] =
  [
    [/北歐|nordic|scandi/i, { style: 'nordic' }],
    [/日式|侘寂|japandi|wabi/i, { style: 'japandi' }],
    [/工業|loft|industrial/i, { style: 'industrial' }],
    [/現代|極簡|modern|minimal/i, { style: 'modern' }],
    [/古典|法式|美式|classic|french/i, { style: 'classic' }],
    [/波西米亞|boho/i, { style: 'boho' }],
    [/溫暖|暖|warm|cozy/i, { warmth: 4 }],
    [/冷|清爽|cool|fresh/i, { warmth: -4 }],
    [/明亮|白|bright|airy|light/i, { bright: 6 }],
    [/暗|沉穩|moody|dark/i, { bright: -8, contrast: 1.1 }],
  ];
export interface StyleRequest {
  style: PhotoStyle;
  prompt?: string;
  /** 0–1；未提供＝風格預設 */
  strength?: number;
  /** 變化序號（多張結果） */
  variant?: number;
}
export function resolveRequest(r: StyleRequest) {
  let style = r.style;
  let warmth = 0;
  let bright = 0;
  let contrast = 1;
  for (const [re, adj] of KEYWORDS)
    if (r.prompt && re.test(r.prompt)) {
      if (adj.style) style = adj.style;
      warmth += adj.warmth ?? 0;
      bright += adj.bright ?? 0;
      contrast *= adj.contrast ?? 1;
    }
  const spec = STYLE_SPECS[style];
  const v = r.variant ?? 0;
  // 變化：強度與暖度輪替，讓多張結果有差異但都在同一風格內
  const strength = Math.min(1, Math.max(0.2, (r.strength ?? spec.strength) + [0, 0.12, -0.12, 0.2][v % 4]!));
  return {
    style,
    spec,
    strength,
    warmth: spec.warmth + warmth + [0, 2, -2, 0][v % 4]!,
    bright,
    contrast: spec.contrast * contrast,
  };
}

// ── 色彩空間（sRGB ↔ Lab，D65）──────────────────────────────────────
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const fi = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r / 255);
  const G = lin(g / 255);
  const B = lin(b / 255);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fy = f(y);
  return [116 * fy - 16, 500 * (f(x) - fy), 200 * (fy - f(z))];
}
export function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const x = fi(fy + a / 500) * 0.95047;
  const y = fi(fy);
  const z = fi(fy - bb / 200) * 1.08883;
  const R = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const G = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const B = 0.0557 * x - 0.204 * y + 1.057 * z;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, v))) * 255)));
  return [c(R), c(G), c(B)];
}

type Stats = { mean: [number, number, number]; std: [number, number, number] };
function statsOf(labs: [number, number, number][]): Stats {
  const n = Math.max(1, labs.length);
  const mean: [number, number, number] = [0, 0, 0];
  for (const p of labs) for (let k = 0; k < 3; k++) mean[k]! += p[k]! / n;
  const std: [number, number, number] = [0, 0, 0];
  for (const p of labs) for (let k = 0; k < 3; k++) std[k]! += (p[k]! - mean[k]!) ** 2 / n;
  return { mean, std: std.map((v) => Math.max(1e-3, Math.sqrt(v))) as [number, number, number] };
}
const hexLab = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
};

/** 遮罩羽化（box blur 兩次，半徑 r 像素）；mask 為 0–255 */
export function featherMask(
  mask: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Float32Array {
  let cur = Float32Array.from(mask, (v) => v / 255);
  if (r < 1) return cur;
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += cur[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s / (2 * r + 1);
        s += cur[y * w + Math.min(w - 1, x + r + 1)]! - cur[y * w + Math.max(0, x - r)]!;
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / (2 * r + 1);
        s += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
      }
    }
    cur = out;
  }
  return cur;
}

/**
 * 本機預覽換風格：Reinhard 色彩轉移（Lab）＋對比、暖度、明暗；mask（0–255）只影響遮罩內（羽化）。
 * rgba 會被複製，不修改輸入。
 */
export function restylePixels(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  req: StyleRequest,
  mask?: Uint8Array | Uint8ClampedArray | null,
): Uint8ClampedArray {
  const r = resolveRequest(req);
  const out = new Uint8ClampedArray(rgba);
  // 來源統計（抽樣）
  const step = Math.max(1, Math.floor((w * h) / 20000));
  const samples: [number, number, number][] = [];
  for (let i = 0; i < w * h; i += step)
    samples.push(rgbToLab(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!));
  const src = statsOf(samples);
  const tgt = statsOf(r.spec.palette.map(hexLab));
  // 亮度保留來源的分佈（只把平均往風格移一部分），色度完全轉移 → 結構與明暗關係不變
  const tMean: [number, number, number] = [
    src.mean[0] + (tgt.mean[0] - src.mean[0]) * 0.35 + r.bright,
    tgt.mean[1],
    tgt.mean[2] + r.warmth,
  ];
  const tStd: [number, number, number] = [src.std[0] * r.contrast, tgt.std[1], tgt.std[2]];
  const m = mask ? featherMask(mask, w, h, Math.max(2, Math.round(Math.min(w, h) / 120))) : null;
  for (let i = 0; i < w * h; i++) {
    const k = r.strength * (m ? m[i]! : 1);
    if (k <= 0.001) continue;
    const [L, a, b] = rgbToLab(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);
    const lab = [L, a, b].map((v, c) => ((v - src.mean[c]!) / src.std[c]!) * tStd[c]! + tMean[c]!);
    const [R, G, B] = labToRgb(lab[0]!, lab[1]!, lab[2]!);
    out[i * 4] = rgba[i * 4]! + (R - rgba[i * 4]!) * k;
    out[i * 4 + 1] = rgba[i * 4 + 1]! + (G - rgba[i * 4 + 1]!) * k;
    out[i * 4 + 2] = rgba[i * 4 + 2]! + (B - rgba[i * 4 + 2]!) * k;
  }
  return out;
}

/** 供應商介面：本機預覽或（之後）雲端 AI；回傳 PNG/JPEG Blob */
export interface PhotoStyleProvider {
  id: 'local-preview' | 'api';
  /** true＝真實 AI 生成；false＝本機色彩轉移預覽 */
  generative: boolean;
  generate(photo: ImageBitmap, req: StyleRequest, mask?: Uint8Array | null): Promise<Blob>;
}

export const localPreviewProvider: PhotoStyleProvider = {
  id: 'local-preview',
  generative: false,
  async generate(photo, req, mask) {
    const c = document.createElement('canvas');
    c.width = photo.width;
    c.height = photo.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(photo, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    const px = restylePixels(img.data, c.width, c.height, req, mask);
    g.putImageData(new ImageData(new Uint8ClampedArray(px), c.width, c.height), 0, 0);
    return new Promise<Blob>((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.9),
    );
  },
};
