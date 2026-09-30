import {
  canny,
  dilate,
  resize,
  structureRecall,
  tauPx,
  toGray,
  rgbaToMask,
  type Gray,
  type RGBA,
} from '@interiorai/image-ops';
import type { ModelsConfig, Strictness } from '../models.js';

export interface ValidationResult {
  score: number;
  threshold: number;
  passed: boolean;
  tau: number;
  /** 門檻未用真實供應商與評測集校準（ADR-012）；mock 通過不代表門檻有效 */
  calibrated: boolean;
}

/**
 * 結構驗證（05 §5）：輸出縮放到 G-buffer 尺寸 → Canny → 以 τ 膨脹 → 計算 G-buffer 結構邊緣被覆蓋的比例。
 * 門檻＝使用者選擇的嚴格度，整個 Job 固定（降級不加嚴，ADR-012）。
 */
export function validateStructure(
  output: RGBA,
  gbufferEdge: RGBA,
  strictness: Strictness,
  cfg: ModelsConfig['structure_validation'],
  /** clay（G-buffer color）：只保留在輸入圖上看得見的結構邊緣（ADR-019） */
  clay?: RGBA,
): ValidationResult {
  const edges = rgbaToMask(gbufferEdge);
  const tau = tauPx(edges.width, edges.height, cfg.tolerance_ratio_of_short_side);
  const ref = clay ? visibleStructure(edges, clay, tau) : edges;
  const o = resize(output, ref.width, ref.height);
  const score = structureRecall(ref, canny(toGray(o)), tau);
  const threshold = cfg.recall_threshold[strictness];
  return {
    score: Math.round(score * 10000) / 10000,
    threshold,
    passed: score >= threshold,
    tau,
    calibrated: cfg.calibrated,
  };
}

/**
 * ADR-019：結構參考邊緣＝G-buffer 結構邊緣 ∩ 膨脹後的 clay 可見邊緣。
 * objectId/深度邊界若在 clay 上沒有明暗差（例如與地板同亮度的地毯），任何模型都無法「保留」它，
 * 納入只會造成誤判（評測集：完全保留結構的 mock 在 balanced 下只有 96.7% 通過）。
 */
export function visibleStructure(edges: Gray, clay: RGBA, tau: number): Gray {
  const c = resize(clay, edges.width, edges.height);
  const vis = dilate(canny(toGray(c)), tau);
  const out: Gray = { width: edges.width, height: edges.height, data: new Uint8Array(edges.data.length) };
  for (let i = 0; i < out.data.length; i++) out.data[i] = edges.data[i] && vis.data[i] ? 1 : 0;
  return out;
}
