import { decodePng, encodePng } from '../png.js';
import {
  ProviderError,
  type CallCtx,
  type ImageProvider,
  type InpaintInput,
  type RenderInput,
} from './types.js';

type Poll = { status?: string; result?: { sample?: string } };

/**
 * BFL FLUX 卡片（05 §2 路線 B：深度控制；inpaint 備援：fill）。
 * 已核對（2026-09-30）：x-key 認證、回應 {id, polling_url}、GET polling_url 直到 status=Ready、result.sample 為圖片 URL（10 分鐘失效）。
 * 未核對：FLUX.1 depth/fill 端點是否仍提供（endpoint 由 models.yaml 設定，verified_at: null）。以 HTTP mock 測試。
 */
export class FluxImageProvider implements ImageProvider {
  readonly id = 'flux' as const;
  readonly capabilities = { edit: false, mask: true, depthControl: true, maxRefs: 0, maxSize: 2048 };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly pollMs = 500,
  ) {}

  private async req(url: string, init: RequestInit, signal: AbortSignal) {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { 'x-key': this.apiKey, ...init.headers },
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ProviderError('PROVIDER_UNAVAILABLE', `flux 連線失敗：${(e as Error).message}`, true);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        retryable ? 'PROVIDER_UNAVAILABLE' : 'BAD_REQUEST',
        `flux ${res.status}`,
        retryable,
        res.status,
      );
    }
    return res;
  }

  private async submit(ctx: CallCtx, body: Record<string, unknown>) {
    const t0 = Date.now();
    const r = await this.req(
      `${this.baseUrl}${ctx.endpoint}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      ctx.signal,
    );
    const { polling_url } = (await r.json()) as { polling_url?: string };
    if (!polling_url) throw new ProviderError('BAD_OUTPUT', 'flux 回應缺少 polling_url', true);
    for (;;) {
      await new Promise((res) => setTimeout(res, this.pollMs));
      if (ctx.signal.aborted) throw ctx.signal.reason;
      const p = (await (await this.req(polling_url, { method: 'GET' }, ctx.signal)).json()) as Poll;
      if (p.status === 'Ready' && p.result?.sample) {
        const img = Buffer.from(
          await (await this.req(p.result.sample, { method: 'GET' }, ctx.signal)).arrayBuffer(),
        );
        return {
          image: img,
          model: ctx.model,
          costUsd: ctx.costUsd,
          latencyMs: Date.now() - t0,
          seedSupported: true,
        };
      }
      if (p.status && /moderated/i.test(p.status))
        throw new ProviderError('MODERATION_BLOCKED', `flux ${p.status}`, false);
      if (p.status === 'Error' || p.status === 'Failed' || p.status === 'Task not found')
        throw new ProviderError('PROVIDER_UNAVAILABLE', `flux ${p.status}`, true);
    }
  }

  render(i: RenderInput, ctx: CallCtx) {
    return this.submit(ctx, {
      prompt: i.prompt,
      control_image: i.gbuffer.depth.toString('base64'),
      output_format: 'png',
      seed: i.seed,
    });
  }

  /** FLUX fill 的遮罩為白＝要改；由 GPT Image 格式（透明＝要改）轉換 */
  inpaint(i: InpaintInput, ctx: CallCtx) {
    const a = decodePng(i.mask);
    const out = { width: a.width, height: a.height, data: new Uint8Array(a.data.length) };
    for (let k = 0; k < a.width * a.height; k++) {
      const v = a.data[k * 4 + 3] === 0 ? 255 : 0;
      out.data.set([v, v, v, 255], k * 4);
    }
    return this.submit(ctx, {
      prompt: i.prompt,
      image: i.base.toString('base64'),
      mask: encodePng(out).toString('base64'),
      output_format: 'png',
      seed: i.seed,
    });
  }
}
