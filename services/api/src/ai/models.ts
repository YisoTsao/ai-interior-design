import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT } from '../config.js';

export type Strictness = 'free' | 'balanced' | 'strict';
export interface ModelEntry {
  model: string;
  endpoint?: string;
  cost_usd_per_image?: number;
  max_size?: number;
  verified_at?: string | null;
}
export interface ModelsConfig {
  providers: {
    openai: { base_url: string; image: Record<string, ModelEntry> };
    flux: { base_url: string } & Record<string, ModelEntry | string>;
    mock: { image: ModelEntry };
  };
  routing: Record<Strictness | 'inpaint', { primary: string; fallback: string[] }>;
  budgets: { max_usd_per_job: number; max_usd_per_org_per_day: number };
  structure_validation: {
    recall_threshold: Record<Strictness, number>;
    tolerance_ratio_of_short_side: number;
    calibrated: boolean;
  };
  retries: { provider_call_max: number; validation_max: number };
  pricing_credits: { draft_1k: number; final_2k: number; final_4k: number; inpaint: number };
  daily_job_limit: Record<string, number>;
}

export const MODELS_PATH = path.join(REPO_ROOT, 'services/api/models.yaml');

/** 模型名稱/價格不寫死在程式（05 §1）：一律讀 models.yaml（MODELS_CONFIG 可覆寫路徑） */
export async function loadModels(file = process.env.MODELS_CONFIG ?? MODELS_PATH): Promise<ModelsConfig> {
  return parse(await readFile(file, 'utf8')) as ModelsConfig;
}

/** 'openai.image.render_edit' → 供應商 id 與模型項目 */
export function resolveRef(
  cfg: ModelsConfig,
  ref: string,
): { provider: 'openai' | 'flux' | 'mock'; key: string; entry: ModelEntry } {
  const [provider, ...rest] = ref.split('.');
  let node: unknown = (cfg.providers as Record<string, unknown>)[provider!];
  for (const k of rest) node = (node as Record<string, unknown> | undefined)?.[k];
  if (!node || typeof node !== 'object') throw new Error(`models.yaml 找不到 ${ref}`);
  return { provider: provider as 'openai' | 'flux' | 'mock', key: rest.join('.'), entry: node as ModelEntry };
}
