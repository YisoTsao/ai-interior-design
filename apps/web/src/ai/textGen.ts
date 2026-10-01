import type { Catalog, CatalogEntry, Material } from '@interiorai/catalog';

/**
 * 文字生成（FE-AI-05，規則式本機版）：描述 → 程序化材質，或 → 參數化家具（品項＋尺寸＋顏色）。
 * 不是生成式模型；介面標示「規則式」，日後可換成 LLM／影像模型供應商。
 */
const COLORS: [RegExp, string][] = [
  [/深灰|charcoal|炭/i, '#4b4d50'],
  [/淺灰|light grey|light gray/i, '#c9c9c6'],
  [/灰|grey|gray/i, '#9a9a96'],
  [/米白|奶油|cream|ivory|象牙/i, '#efe7d6'],
  [/米色|beige|燕麥|oat/i, '#e3d5bc'],
  [/白|white/i, '#f2f0eb'],
  [/黑|black/i, '#1f1f21'],
  [/胡桃|walnut/i, '#5b4130'],
  [/橡木|oak/i, '#c49a6c'],
  [/原木|淺木|natural wood|ash/i, '#d2b48c'],
  [/柚木|teak/i, '#9a6a3c'],
  [/咖啡|棕|褐|brown/i, '#6b4a33'],
  [/磚紅|terracotta|陶土/i, '#b5653f'],
  [/酒紅|burgundy/i, '#6d2a33'],
  [/紅|red/i, '#b0413e'],
  [/橘|orange/i, '#d9822b'],
  [/芥末|mustard/i, '#c9a227'],
  [/黃|yellow/i, '#e3c14b'],
  [/金|gold|黃銅|brass/i, '#c2a15f'],
  [/墨綠|forest/i, '#2f4f3f'],
  [/薄荷|mint/i, '#9cc2ae'],
  [/鼠尾草|sage/i, '#9caf88'],
  [/綠|green/i, '#5f8f5f'],
  [/深藍|海軍藍|navy/i, '#2b3a55'],
  [/藍|blue/i, '#4a6fa5'],
  [/粉|pink|blush/i, '#e3b0b4'],
  [/紫|purple|lavender/i, '#8b6fa8'],
];
export function parseColor(text: string): string | null {
  const hex = /#([0-9a-f]{6})\b/i.exec(text);
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  for (const [re, c] of COLORS) if (re.test(text)) return c;
  return null;
}
/** 「60x60」「60×120 公分」「1200 mm」→ mm；cm 為預設單位（數字 < 30 視為公尺） */
export function parseSizes(text: string): number[] {
  const unit = /mm|公釐|毫米/i.test(text)
    ? 1
    : /(?<![a-z])m\b|公尺|米(?!色)/i.test(text) && !/cm|公分/i.test(text)
      ? 1000
      : 10;
  const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  return nums.map((n) => Math.round(n * (unit === 10 && n < 30 && /米|公尺|m\b/i.test(text) ? 1000 : unit)));
}

const slug = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
};

export function textToMaterial(text: string): Material {
  const t = text.trim();
  const color = parseColor(t) ?? '#d8d2c6';
  const sizes = parseSizes(t).filter((n) => n >= 50);
  let category: Material['category'] = 'wall';
  if (/地板|地磚|floor|木地板/i.test(t)) category = 'floor';
  else if (/布|絨|皮|fabric|linen|leather/i.test(t)) category = 'fabric';
  else if (/金屬|不鏽鋼|鋁|鐵|brass|steel|metal|黃銅/i.test(t)) category = 'metal';
  else if (/大理石|石材|水磨|花崗|marble|stone|terrazzo/i.test(t)) category = 'stone';
  else if (/木皮|木作|veneer/i.test(t)) category = 'wood';
  else if (/天花|ceiling/i.test(t)) category = 'ceiling';
  let pattern: Material['pattern'] = 'plain';
  let motif: Material['motif'];
  if (/條紋|stripe/i.test(t)) [pattern, motif] = ['wallpaper', /細/.test(t) ? 'pinstripe' : 'stripe'];
  else if (/格紋|格子|check|plaid/i.test(t)) [pattern, motif] = ['wallpaper', 'check'];
  else if (/大馬士革|damask/i.test(t)) [pattern, motif] = ['wallpaper', 'damask'];
  else if (/花|floral/i.test(t)) [pattern, motif] = ['wallpaper', 'floral'];
  else if (/圓點|點點|dots|polka/i.test(t)) [pattern, motif] = ['wallpaper', 'dots'];
  else if (/人字|herringbone/i.test(t)) [pattern, motif] = ['wallpaper', 'herringbone'];
  else if (/幾何|geometric/i.test(t)) [pattern, motif] = ['wallpaper', 'geometric'];
  else if (/木|wood|oak|walnut/i.test(t)) pattern = 'wood';
  else if (/磚|tile/i.test(t)) pattern = 'tile';
  else if (category === 'stone') pattern = 'stone';
  const glossy = /亮面|拋光|鏡面|glossy|polished/i.test(t);
  const matte = /霧面|啞光|matte/i.test(t);
  const metal = category === 'metal';
  const real =
    sizes.length >= 2
      ? { w: sizes[0]!, h: sizes[1]! }
      : sizes.length === 1
        ? { w: sizes[0]!, h: sizes[0]! }
        : pattern === 'wood'
          ? { w: 1200, h: 200 }
          : pattern === 'wallpaper'
            ? { w: 530, h: 530 }
            : pattern === 'tile'
              ? { w: 600, h: 600 }
              : { w: 1000, h: 1000 };
  const accent = motif ? (parseColor(t.replace(/^[^，,與和]+[，,與和]/, '')) ?? undefined) : undefined;
  return {
    id: `um_gen_${slug(t)}`,
    nameZh: t.slice(0, 30) || '生成材質',
    nameEn: t.slice(0, 30) || 'Generated material',
    category,
    color,
    pattern,
    ...(motif ? { motif, accent: accent && accent !== color ? accent : shade(color, 0.78) } : {}),
    realSizeMm: real,
    roughness: glossy ? 0.18 : matte ? 0.9 : metal ? 0.35 : pattern === 'wood' ? 0.5 : 0.75,
    ...(metal ? { metalness: 0.9 } : {}),
    license: { type: 'user-provided', source: '文字生成（規則式）', allowedUse: ['render'] },
  };
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

export interface FurnitureGuess {
  entry: CatalogEntry;
  params: Record<string, number>;
  color: string | null;
  score: number;
}
/** 描述 → 最接近的參數化家具＋尺寸（寬／深／高，依參數範圍夾值）＋顏色 */
export function textToFurniture(text: string, catalog: Catalog): FurnitureGuess | null {
  const t = text.toLowerCase();
  let best: { e: CatalogEntry; s: number } | null = null;
  for (const e of catalog.all()) {
    if (e.status !== 'published' || ['openings', 'structure', 'mep'].includes(e.category)) continue;
    let s = 0;
    const words = [e.nameZh, e.nameEn ?? '', ...e.tags].map((x) => x.toLowerCase()).filter(Boolean);
    for (const w of words) {
      if (t.includes(w)) s += w.length * 2;
      else for (const part of w.split(/[\s_-]+/)) if (part.length >= 2 && t.includes(part)) s += part.length;
    }
    // 中文：逐字重疊（沙發、書桌…）
    for (const ch of new Set(e.nameZh)) if (/[一-鿿]/.test(ch) && text.includes(ch)) s += 1;
    if (!best || s > best.s) best = { e, s };
  }
  if (!best || best.s < 2) return null;
  const e = best.e;
  const params: Record<string, number> = {};
  const sizes = parseSizes(text).filter((n) => n >= 100);
  const spec = e.model.kind === 'parametric' ? e.model.params : {};
  const set = (k: 'w' | 'd' | 'h', v: number | undefined) => {
    const p = spec[k] as { min?: number; max?: number } | undefined;
    if (v === undefined || !p || p.min === undefined || p.max === undefined) return;
    params[k] = Math.max(p.min, Math.min(p.max, v));
  };
  const labeled = (re: RegExp) => {
    const m = re.exec(text);
    return m ? parseSizes(m[0])[0] : undefined;
  };
  const w = labeled(/(寬|長|w)\s*\d+(\.\d+)?\s*(cm|公分|mm|公釐|m|公尺)?/i);
  const d = labeled(/(深|d)\s*\d+(\.\d+)?\s*(cm|公分|mm|公釐|m|公尺)?/i);
  const h = labeled(/(高|h)\s*\d+(\.\d+)?\s*(cm|公分|mm|公釐|m|公尺)?/i);
  if (w || d || h) {
    set('w', w);
    set('d', d);
    set('h', h);
  } else {
    set('w', sizes[0]);
    set('d', sizes[1]);
    set('h', sizes[2]);
  }
  return { entry: e, params, color: parseColor(text), score: best.s };
}
