import type { Db } from '../db/db.js';
import type { Storage } from '../infra/storage.js';
import { log } from '../common/log.js';
import { loadModels } from './models.js';
import { FluxImageProvider } from './providers/flux.js';
import { MockImageProvider, type MockMode } from './providers/mock.js';
import { OpenAIImageProvider } from './providers/openai.js';
import type { ImageProvider } from './providers/types.js';
import { ProviderRouter } from './router/index.js';
import { createAiProcessors } from './render.processor.js';

/**
 * 組裝 AI 執行環境（worker 用）。金鑰只存在後端環境變數（B6.1-1、B9.5）。
 * AI_PROVIDER=mock（預設，CI/E2E）→ 所有路線走確定性 mock；AI_MOCK_MODE 選 ok/break_structure/slow/fail。
 */
export async function createAiRuntime(
  deps: { db: Db; storage: Storage },
  env: NodeJS.ProcessEnv = process.env,
  opts: { mockMode?: () => MockMode; backoffMs?: number; mockCostUsd?: number } = {},
) {
  const models = await loadModels(env.MODELS_CONFIG);
  const mockAll = (env.AI_PROVIDER ?? 'mock') === 'mock';
  const providers: Partial<Record<'openai' | 'flux' | 'mock', ImageProvider>> = {
    mock: new MockImageProvider(opts.mockMode ?? (() => (env.AI_MOCK_MODE as MockMode | undefined) ?? 'ok')),
  };
  if (!mockAll) {
    if (env.OPENAI_API_KEY)
      providers.openai = new OpenAIImageProvider(models.providers.openai.base_url, env.OPENAI_API_KEY);
    if (env.BFL_API_KEY)
      providers.flux = new FluxImageProvider(models.providers.flux.base_url, env.BFL_API_KEY);
    if (!providers.openai && !providers.flux)
      log.warn('ai.no_provider_keys', { hint: '設定 OPENAI_API_KEY / BFL_API_KEY 或 AI_PROVIDER=mock' });
  }
  const router = new ProviderRouter(models, providers, { mockAll, mockCostUsd: opts.mockCostUsd });
  return {
    models,
    router,
    providers,
    processors: createAiProcessors({ ...deps, models, router, backoffMs: opts.backoffMs }),
  };
}
