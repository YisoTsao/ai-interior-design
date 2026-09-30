import {
  ProviderError,
  type CallCtx,
  type ImageProvider,
  type InpaintInput,
  type RenderInput,
} from './types.js';

/**
 * OpenAI 圖像編輯卡片（05 §2 路線 A）。依 2026-09-30 核對的官方 API reference（models.yaml 註記）：
 * POST {base}/images/edits，multipart；image[] 最多 16 張；mask 為 PNG、與第一張同尺寸、只作用於第一張；
 * size = WxH（16 的倍數）；回應 data[0].b64_json。真實呼叫未在 CI 執行（需金鑰）→ 以 HTTP mock 測試。
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly id = 'openai' as const;
  readonly capabilities = { edit: true, mask: true, depthControl: false, maxRefs: 16, maxSize: 3840 };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(form: FormData, ctx: CallCtx) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${ctx.endpoint ?? '/images/edits'}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: ctx.signal,
      });
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      throw new ProviderError('PROVIDER_UNAVAILABLE', `openai 連線失敗：${(e as Error).message}`, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      let message = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
        code = j.error?.code ?? '';
        message = j.error?.message ?? message;
      } catch {
        /* 非 JSON */
      }
      if (code === 'moderation_blocked' || /safety|moderation/i.test(code))
        throw new ProviderError('MODERATION_BLOCKED', message, false, res.status);
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        retryable ? 'PROVIDER_UNAVAILABLE' : 'BAD_REQUEST',
        message,
        retryable,
        res.status,
      );
    }
    const b64 = (JSON.parse(text) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
    if (!b64) throw new ProviderError('BAD_OUTPUT', 'openai 回應缺少 b64_json', true, res.status);
    return {
      image: Buffer.from(b64, 'base64'),
      model: ctx.model,
      costUsd: ctx.costUsd,
      latencyMs: Date.now() - t0,
      seedSupported: false,
    };
  }

  private form(ctx: CallCtx, prompt: string, images: Buffer[], size?: { w: number; h: number }) {
    const f = new FormData();
    f.set('model', ctx.model);
    f.set('prompt', prompt);
    f.set('n', '1');
    f.set('output_format', 'png');
    if (size) f.set('size', `${size.w}x${size.h}`);
    images
      .slice(0, this.capabilities.maxRefs)
      .forEach((img, k) =>
        f.append('image[]', new Blob([new Uint8Array(img)], { type: 'image/png' }), `image-${k + 1}.png`),
      );
    return f;
  }

  render(i: RenderInput, ctx: CallCtx) {
    // image 1 = clay（主圖）、image 2 = 結構邊緣圖、其餘 = 參考圖（prompts/render.balanced.md）
    return this.call(
      this.form(ctx, i.prompt, [i.gbuffer.color, i.gbuffer.edge, ...(i.references ?? [])], i.size),
      ctx,
    );
  }

  inpaint(i: InpaintInput, ctx: CallCtx) {
    const f = this.form(ctx, i.prompt, [i.base, ...(i.references ?? [])]);
    f.set('mask', new Blob([new Uint8Array(i.mask)], { type: 'image/png' }), 'mask.png');
    return this.call(f, ctx);
  }
}
