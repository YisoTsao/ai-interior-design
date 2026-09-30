/**
 * 效果圖後製（FE-RND-05）：曝光、白平衡（色溫）、飽和、對比、裁切比例、浮水印、文字標籤。
 * 預覽用 CSS filter，輸出用 canvas（ctx.filter＋色溫以 multiply 疊色）。
 */
export interface PhotoEdit {
  exposure: number; // EV −2..+2
  temperature: number; // −100 冷 .. +100 暖
  saturation: number; // 0..2
  contrast: number; // 0.5..1.5
  crop: 'original' | '16:9' | '4:3' | '1:1' | '9:16';
  watermark: string;
  labels: { x: number; y: number; text: string }[]; // x,y 0–1
}
export const DEFAULT_EDIT: PhotoEdit = {
  exposure: 0,
  temperature: 0,
  saturation: 1,
  contrast: 1,
  crop: 'original',
  watermark: '',
  labels: [],
};

export const cssFilter = (e: PhotoEdit) =>
  `brightness(${2 ** e.exposure}) contrast(${e.contrast}) saturate(${e.saturation})`;

/** 色溫疊色（multiply）：暖＝橘、冷＝藍；強度與 |temperature| 成正比 */
export function tempTint(t: number): string | null {
  if (!t) return null;
  const k = Math.min(1, Math.abs(t) / 100) * 0.35;
  const [r, g, b] = t > 0 ? [255, 190, 120] : [140, 185, 255];
  const mix = (c: number) => Math.round(255 - (255 - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** 裁切框（置中，最大面積）：回傳來源影像中的 sx, sy, sw, sh */
export function cropRect(w: number, h: number, crop: PhotoEdit['crop']): [number, number, number, number] {
  if (crop === 'original') return [0, 0, w, h];
  const [a, b] = crop.split(':').map(Number) as [number, number];
  const target = a / b;
  if (w / h > target) {
    const sw = Math.round(h * target);
    return [Math.round((w - sw) / 2), 0, sw, h];
  }
  const sh = Math.round(w / target);
  return [0, Math.round((h - sh) / 2), w, sh];
}

export async function renderEdit(src: Blob, e: PhotoEdit): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const [sx, sy, sw, sh] = cropRect(bmp.width, bmp.height, e.crop);
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const g = c.getContext('2d')!;
  g.filter = cssFilter(e);
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  g.filter = 'none';
  const tint = tempTint(e.temperature);
  if (tint) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = tint;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = 'source-over';
  }
  const fs = Math.max(14, Math.round(sw / 60));
  g.font = `600 ${fs}px system-ui, 'Noto Sans TC', sans-serif`;
  for (const l of e.labels) {
    const x = l.x * sw;
    const y = l.y * sh;
    const tw = g.measureText(l.text).width;
    g.fillStyle = 'rgba(0,0,0,.65)';
    g.fillRect(x - 8, y - fs, tw + 16, fs * 1.5);
    g.fillStyle = '#fff';
    g.fillText(l.text, x, y + fs * 0.2);
  }
  if (e.watermark) {
    g.font = `700 ${fs * 1.2}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.textAlign = 'right';
    g.fillText(e.watermark, sw - fs, sh - fs);
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}
