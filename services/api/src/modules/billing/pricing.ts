import type { ModelsConfig } from '../../ai/models.js';

export type Resolution = '1k' | '2k' | '4k';
/** 長邊像素 */
export const LONG_SIDE: Record<Resolution, number> = { '1k': 1024, '2k': 2048, '4k': 3840 };

/**
 * 點數價目（05 §9）：依 (解析度, 種類) 查 models.yaml `pricing_credits`（〔假設〕待商業定價）。
 * reserve＝此值（ADR-014：最大成本）；重試/降級不另收費。
 */
export function creditsFor(
  cfg: ModelsConfig,
  kind: 'render' | 'inpaint',
  resolution: Resolution = '1k',
): number {
  const p = cfg.pricing_credits;
  if (kind === 'inpaint') return p.inpaint;
  return resolution === '1k' ? p.draft_1k : resolution === '2k' ? p.final_2k : p.final_4k;
}

/** 輸出尺寸：保持 G-buffer 長寬比、長邊＝解析度、兩邊都是 16 的倍數（GPT Image 規則） */
export function outputSize(gw: number, gh: number, resolution: Resolution) {
  const long = LONG_SIDE[resolution];
  const k = long / Math.max(gw, gh);
  const r16 = (v: number) => Math.max(16, Math.round((v * k) / 16) * 16);
  return { w: r16(gw), h: r16(gh) };
}
