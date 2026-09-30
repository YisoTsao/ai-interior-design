import { resolveRef, type ModelsConfig, type Strictness } from '../models.js';
import type { ImageProvider } from '../providers/types.js';

export type RouteKind = Strictness | 'inpaint';
/** 路線代號（provenance 用）：A＝影像編輯（GPT Image）、B＝深度/邊緣控制、C＝填補 */
export const routeLabel = (ref: string) => (/depth|canny/.test(ref) ? 'B' : /fill/.test(ref) ? 'C' : 'A');

export interface RouteCandidate {
  ref: string;
  route: 'A' | 'B' | 'C';
  provider: ImageProvider;
  model: string;
  endpoint?: string;
  costUsd: number;
}

/** 熔斷器：連續失敗 threshold 次 → 開路 cooldownMs；冷卻後半開放一次試探 */
export class CircuitBreaker {
  private fails = new Map<string, number>();
  private openUntil = new Map<string, number>();
  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}
  available(id: string) {
    return (this.openUntil.get(id) ?? 0) <= this.now();
  }
  success(id: string) {
    this.fails.set(id, 0);
    this.openUntil.delete(id);
  }
  reset() {
    this.fails.clear();
    this.openUntil.clear();
  }
  failure(id: string) {
    const n = (this.fails.get(id) ?? 0) + 1;
    this.fails.set(id, n);
    if (n >= this.threshold) this.openUntil.set(id, this.now() + this.cooldownMs);
  }
}

/**
 * 路由（05 §2）：依嚴格度取 [首選, ...備援]；略過熔斷中的供應商。
 * AI_PROVIDER=mock 時所有路線都指向 mock provider（保留路線代號，讓降級邏輯照常被測到）。
 */
export class ProviderRouter {
  constructor(
    private readonly cfg: ModelsConfig,
    private readonly providers: Partial<Record<'openai' | 'flux' | 'mock', ImageProvider>>,
    private readonly opts: { mockAll: boolean; mockCostUsd?: number },
    readonly breaker = new CircuitBreaker(),
  ) {}

  candidates(kind: RouteKind): RouteCandidate[] {
    const r = this.cfg.routing[kind];
    return [r.primary, ...r.fallback].flatMap((ref) => {
      const { provider, entry } = resolveRef(this.cfg, ref);
      const p = this.opts.mockAll ? this.providers.mock : this.providers[provider];
      if (!p) return [];
      return [
        {
          ref,
          route: routeLabel(ref) as 'A' | 'B' | 'C',
          provider: p,
          model: this.opts.mockAll ? `mock:${entry.model}` : entry.model,
          endpoint: entry.endpoint,
          costUsd: this.opts.mockAll ? (this.opts.mockCostUsd ?? 0) : (entry.cost_usd_per_image ?? 0),
        },
      ];
    });
  }

  /** 依序可用的候選（熔斷中者排除；全部熔斷時仍回原清單以便回報錯誤） */
  available(kind: RouteKind): RouteCandidate[] {
    const all = this.candidates(kind);
    const ok = all.filter((c) => this.breaker.available(`${c.provider.id}:${c.ref}`));
    return ok.length ? ok : all;
  }
}
