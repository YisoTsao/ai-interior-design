import { quoteOf, type QuoteSettings } from '@interiorai/app-state';
import { computeBOM, type BomKind, type BomLine } from '@interiorai/core-geometry';
import type { Scene } from '@interiorai/scene-schema';
import { catalog, materials } from '../catalogData';

export const DEFAULT_TAX = 0.05;
export const DEFAULT_WASTE = 0.1;

export interface QuoteLine extends BomLine {
  name: string;
  /** 含損耗的計價數量（m² 項目） */
  billedQty: number;
  overridden: boolean;
}
export interface Quote {
  lines: QuoteLine[];
  rooms: { id: string; name: string; total: number }[];
  subtotal: number;
  extras: number;
  discount: number;
  tax: number;
  total: number;
  settings: Required<Pick<QuoteSettings, 'taxRate' | 'wastePct'>> & QuoteSettings;
}

/**
 * 報價（FE-DOC-01）：BOM（core-geometry computeBOM）＋自訂單價、材質損耗、其他費用、折扣、稅。
 * 自訂單價存於 scene.meta.quote.prices（隨專案保存）。
 */
export function buildQuote(scene: Scene, lang: string): Quote {
  const matById = new Map(materials.map((m) => [m.id, m]));
  const st = quoteOf(scene);
  const taxRate = st.taxRate ?? DEFAULT_TAX;
  const wastePct = st.wastePct ?? DEFAULT_WASTE;
  const prices = st.prices ?? {};
  const cat = {
    get: (id: string) => {
      const e = catalog.get(id);
      const p = prices[id] ?? e?.unitPriceTwd;
      return e || p !== undefined ? { id, ...(p !== undefined ? { unitPriceTwd: p } : {}) } : undefined;
    },
  };
  const mats = new Proxy({} as Record<string, { pricePerM2Twd?: number }>, {
    get: (_, id: string) => {
      const p = prices[id] ?? matById.get(id)?.pricePerM2Twd;
      return p !== undefined ? { pricePerM2Twd: p } : undefined;
    },
  });
  const name = (kind: BomKind, key: string) => {
    if (kind === 'object' || kind === 'opening') {
      const e = catalog.get(key);
      return e ? (lang === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh) : key;
    }
    const m = matById.get(key);
    return m ? (lang === 'en' ? (m.nameEn ?? m.nameZh) : m.nameZh) : key;
  };
  const price = (l: BomLine) => {
    const q = l.unit === 'm2' ? Math.round(l.quantity * (1 + wastePct) * 100) / 100 : l.quantity;
    const sub = l.unitPriceTwd !== undefined ? Math.round(l.unitPriceTwd * q) : undefined;
    return { billedQty: q, subtotalTwd: sub };
  };
  const bom = computeBOM(scene, cat, mats);
  const lines: QuoteLine[] = bom.lines.map((l) => {
    const p = price(l);
    return {
      ...l,
      ...p,
      name: name(l.kind, l.key),
      overridden: prices[l.key] !== undefined,
    };
  });
  const subtotal = lines.reduce((s, l) => s + (l.subtotalTwd ?? 0), 0);
  const rooms = scene.levels.flatMap((lv) =>
    lv.rooms.map((r) => {
      let total = 0;
      try {
        total = computeBOM(scene, cat, mats, { roomId: r.id }).lines.reduce(
          (s, l) => s + (price(l).subtotalTwd ?? 0),
          0,
        );
      } catch {
        /* 房間幾何不完整 */
      }
      return { id: r.id, name: r.label ?? r.id, total };
    }),
  );
  const extras = (st.extras ?? []).reduce((s, e) => s + (e.amount || 0), 0);
  const discount = Math.max(0, st.discount ?? 0);
  const taxable = Math.max(0, subtotal + extras - discount);
  const tax = Math.round(taxable * taxRate);
  return {
    lines,
    rooms,
    subtotal,
    extras,
    discount,
    tax,
    total: taxable + tax,
    settings: { ...st, taxRate, wastePct },
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV（UTF-8 BOM，Excel 可直接開啟中文） */
export function quoteCsv(
  q: Quote,
  h: { headers: string[]; kind: (k: BomKind) => string; summary: [string, number][] },
) {
  const rows: (string | number)[][] = [h.headers];
  for (const l of q.lines)
    rows.push([
      h.kind(l.kind),
      l.name,
      l.key,
      l.billedQty,
      l.unit,
      l.unitPriceTwd ?? '',
      l.subtotalTwd ?? '',
    ]);
  rows.push([]);
  for (const [k, v] of h.summary) rows.push(['', k, '', '', '', '', v]);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
