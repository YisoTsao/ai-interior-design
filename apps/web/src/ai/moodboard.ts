import type { CatalogEntry, Material } from '@interiorai/catalog';

/**
 * 情境板分析（FE-AI-06，瀏覽器內、不需後端）：
 * 1. 取樣像素 → k-means 萃取 5–6 色主色盤（依佔比排序）；
 * 2. 由色盤的明度、彩度、冷暖推斷風格標籤（北歐／日式侘寂／現代／工業／輕奢／中世紀）；
 * 3. 依風格標籤與色盤相近的主材質推薦資產，並推薦牆面色卡。
 */
export interface Swatch {
  hex: string;
  weight: number;
}
type RGB = [number, number, number];
const toHex = ([r, g, b]: RGB) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** RGBA 像素 → 主色盤（k-means++ 初始化、固定亂數種子 → 可重現） */
export function extractPalette(data: ArrayLike<number>, k = 6, maxSamples = 6000): Swatch[] {
  const px: RGB[] = [];
  const n = data.length / 4;
  const step = Math.max(1, Math.floor(n / maxSamples));
  for (let i = 0; i < n; i += step) {
    if ((data[i * 4 + 3] ?? 255) < 128) continue;
    px.push([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!]);
  }
  if (!px.length) return [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const centers: RGB[] = [px[Math.floor(rnd() * px.length)]!];
  while (centers.length < Math.min(k, px.length)) {
    const dist = px.map((p) => Math.min(...centers.map((c) => d2(p, c))));
    const sum = dist.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    let r = rnd() * sum;
    let idx = 0;
    while (r > dist[idx]! && idx < dist.length - 1) r -= dist[idx++]!;
    centers.push([...px[idx]!] as RGB);
  }
  const assign = new Array<number>(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    px.forEach((p, i) => {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      assign[i] = best;
    });
    centers.forEach((c, j) => {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let cnt = 0;
      px.forEach((p, i) => {
        if (assign[i] !== j) return;
        s0 += p[0];
        s1 += p[1];
        s2 += p[2];
        cnt++;
      });
      if (cnt) centers[j] = [s0 / cnt, s1 / cnt, s2 / cnt];
    });
  }
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  return centers
    .map((c, j) => ({ hex: toHex(c), weight: counts[j]! / px.length }))
    .filter((s) => s.weight > 0.01)
    .sort((a, b) => b.weight - a.weight);
}

/** HSL（h 0–360，s／l 0–1） */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** 風格分數（0–1，排序後回傳） */
export function inferStyles(p: readonly Swatch[]): { style: string; score: number }[] {
  if (!p.length) return [];
  const avg = (f: (x: ReturnType<typeof hsl>) => number) =>
    p.reduce((s, x) => s + f(hsl(x.hex)) * x.weight, 0) / p.reduce((s, x) => s + x.weight, 0);
  const L = avg((x) => x.l);
  const S = avg((x) => x.s);
  const warm = avg((x) => (x.s > 0.08 && (x.h < 60 || x.h > 330) ? 1 : 0));
  const cool = avg((x) => (x.s > 0.08 && x.h > 150 && x.h < 260 ? 1 : 0));
  const dark = avg((x) => (x.l < 0.3 ? 1 : 0));
  const jewel = avg((x) => (x.s > 0.35 && x.l < 0.5 ? 1 : 0));
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const scores: Record<string, number> = {
    nordic: clamp(L * 1.2 - S * 1.5 + cool * 0.3),
    japandi: clamp(warm * 0.8 + (1 - Math.abs(L - 0.62) * 2) * 0.5 - S * 0.6),
    modern: clamp((1 - S * 2) * 0.6 + Math.abs(L - 0.5) * 0.6 + (1 - warm) * 0.2),
    industrial: clamp(dark * 1.2 + (1 - S * 2) * 0.3 - L * 0.2),
    luxury: clamp(jewel * 1.5 + dark * 0.4),
    midcentury: clamp(warm * 0.6 + S * 0.8 - dark * 0.3),
  };
  return Object.entries(scores)
    .map(([style, score]) => ({ style, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

/** 推薦資產：風格標籤相符＋主材質顏色與色盤接近（距離越近越前） */
export function recommendAssets(
  entries: readonly CatalogEntry[],
  materials: ReadonlyMap<string, Material>,
  palette: readonly Swatch[],
  styles: readonly string[],
  limit = 12,
): CatalogEntry[] {
  const pal = palette.map((s) => hexToRgb(s.hex));
  return entries
    .filter((e) => e.status === 'published' && e.category !== 'openings' && e.category !== 'structure')
    .map((e) => {
      const m = materials.get(e.materialSlots[0]?.defaultMaterialId ?? '');
      const c = m ? hexToRgb(m.color) : null;
      const colorD = c && pal.length ? Math.sqrt(Math.min(...pal.map((p) => d2(p, c)))) / 441 : 0.5;
      const styleHit = e.styleTags.some((t) => styles.includes(t)) ? 0 : 0.6;
      return { e, s: colorD + styleHit };
    })
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.e);
}

/** 從影像檔取樣像素（縮到 160 px） */
export async function imagePixels(file: Blob): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height).data;
}
