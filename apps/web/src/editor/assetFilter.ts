import type { CatalogEntry, Material } from '@interiorai/catalog';

/**
 * 資產篩選（FE-AST-02）：風格、主色、材質、價格、尺寸範圍（寬／深／高）、品牌、可訂製。
 * 純函式，供資產庫與測試共用。
 */
export const PRICE_BANDS = [
  { key: 'p1', min: 0, max: 5000 },
  { key: 'p2', min: 5000, max: 20000 },
  { key: 'p3', min: 20000, max: 50000 },
  { key: 'p4', min: 50000, max: Infinity },
] as const;
export const COLOR_FAMILIES = ['white', 'grey', 'black', 'beige', 'brown', 'green', 'blue', 'red'] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];
export const SWATCH: Record<ColorFamily, string> = {
  white: '#f2f0eb',
  grey: '#9c9a96',
  black: '#2b2b2b',
  beige: '#d8cbb5',
  brown: '#7a5537',
  green: '#6f8f5f',
  blue: '#5a7fa8',
  red: '#a8513a',
};
/** 主材質種類（依預設材質的分類） */
export const MATERIAL_KINDS = ['wood', 'fabric', 'metal', 'stone', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** 由色碼判斷色系（資產主色篩選） */
export function colorFamily(hex: string): ColorFamily {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  if (l < 0.22) return 'black';
  if (sat < 0.12) return l > 0.82 ? 'white' : 'grey';
  if (h >= 70 && h < 170) return 'green';
  if (h >= 170 && h < 280) return 'blue';
  if (h < 20 || h >= 330) return 'red';
  return l > 0.62 ? 'beige' : 'brown';
}

export const OWN_BRAND = 'InteriorAI';
export const UPLOAD_BRAND = 'upload';
/** 品牌：目錄有標就用；使用者上傳＝upload；其餘為自產 */
export const brandOf = (e: CatalogEntry) =>
  e.brand ?? (e.tags.includes('user-upload') ? UPLOAD_BRAND : OWN_BRAND);

/** 可訂製：參數化且寬／深／高至少一項可調（訂製櫃、層架、檯面等） */
export function isCustomizable(e: CatalogEntry): boolean {
  if (e.model.kind !== 'parametric') return false;
  const p = e.model.params;
  return ['w', 'd', 'h'].some((k) => {
    const s = p[k] as { min?: number; max?: number } | undefined;
    return !!s && typeof s.min === 'number' && typeof s.max === 'number' && s.max > s.min;
  });
}

export function materialKind(e: CatalogEntry, materials: ReadonlyMap<string, Material>): MaterialKind {
  const m = materials.get(e.materialSlots[0]?.defaultMaterialId ?? '');
  const c = m?.category;
  return c === 'wood' || c === 'fabric' || c === 'metal' || c === 'stone' ? c : 'other';
}

/** 尺寸範圍（mm；0＝不限） */
export interface SizeRange {
  min: number;
  max: number;
}
export interface AssetFilter {
  style: string | null;
  color: ColorFamily | null;
  price: (typeof PRICE_BANDS)[number]['key'] | null;
  material: MaterialKind | null;
  brand: string | null;
  customizable: boolean;
  w: SizeRange;
  d: SizeRange;
  h: SizeRange;
}
export const EMPTY_FILTER: AssetFilter = {
  style: null,
  color: null,
  price: null,
  material: null,
  brand: null,
  customizable: false,
  w: { min: 0, max: 0 },
  d: { min: 0, max: 0 },
  h: { min: 0, max: 0 },
};
const inRange = (v: number, r: SizeRange) => (!r.min || v >= r.min) && (!r.max || v <= r.max);

/** 啟用中的篩選條件數（顯示在篩選按鈕上） */
export const activeFilters = (f: AssetFilter) =>
  [
    f.style,
    f.color,
    f.price,
    f.material,
    f.brand,
    f.customizable || null,
    f.w.min || f.w.max || null,
    f.d.min || f.d.max || null,
    f.h.min || f.h.max || null,
  ].filter(Boolean).length;

export function matchAsset(
  e: CatalogEntry,
  f: AssetFilter,
  materials: ReadonlyMap<string, Material>,
): boolean {
  if (f.style && !e.styleTags.includes(f.style)) return false;
  if (f.color) {
    const hex = materials.get(e.materialSlots[0]?.defaultMaterialId ?? '')?.color ?? '#cfc6b8';
    if (colorFamily(hex) !== f.color) return false;
  }
  if (f.price) {
    const band = PRICE_BANDS.find((b) => b.key === f.price)!;
    if (e.unitPriceTwd === undefined || e.unitPriceTwd < band.min || e.unitPriceTwd >= band.max) return false;
  }
  if (f.material && materialKind(e, materials) !== f.material) return false;
  if (f.brand && brandOf(e) !== f.brand) return false;
  if (f.customizable && !isCustomizable(e)) return false;
  return inRange(e.dimsMm.w, f.w) && inRange(e.dimsMm.d, f.d) && inRange(e.dimsMm.h, f.h);
}
