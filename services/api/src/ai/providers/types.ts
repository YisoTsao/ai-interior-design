/**
 * 影像供應商抽象（05 §1）。與規格的差異：輸入為 PNG 位元組而非 URL——
 * worker 已從私有桶取回 G-buffer，直接以 multipart/base64 傳給供應商，不必另外產生公開 URL。
 */
export interface RenderInput {
  /** G-buffer PNG（同尺寸） */
  gbuffer: { color: Buffer; depth: Buffer; edge: Buffer; objectId: Buffer; normal?: Buffer };
  /** 請求輸出尺寸（px，16 的倍數） */
  size: { w: number; h: number };
  prompt: string;
  references?: Buffer[];
  seed: number;
}
export interface InpaintInput {
  /** 要編輯的效果圖（遮罩套用於此圖） */
  base: Buffer;
  /** GPT Image 格式遮罩：透明＝要改（PNG、同尺寸） */
  mask: Buffer;
  prompt: string;
  references?: Buffer[];
  seed: number;
}
export interface ProviderResult {
  image: Buffer;
  model: string;
  costUsd: number;
  latencyMs: number;
  seedSupported: boolean;
}
export interface CallCtx {
  signal: AbortSignal;
  model: string;
  endpoint?: string;
  costUsd: number;
}

export interface ImageProvider {
  readonly id: 'openai' | 'flux' | 'mock';
  readonly capabilities: {
    edit: boolean;
    mask: boolean;
    depthControl: boolean;
    maxRefs: number;
    maxSize: number;
  };
  render(i: RenderInput, ctx: CallCtx): Promise<ProviderResult>;
  inpaint(i: InpaintInput, ctx: CallCtx): Promise<ProviderResult>;
}

/**
 * 供應商錯誤。retryable：5xx/逾時/429 → 呼叫層退避重試（不計入 retry_count，ADR-012）。
 * MODERATION_BLOCKED：被審核拒絕，不重試。BAD_OUTPUT：尺寸不符等，視為該次呼叫失敗（05 §6）。
 */
export class ProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_UNAVAILABLE' | 'MODERATION_BLOCKED' | 'BAD_OUTPUT' | 'BAD_REQUEST',
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}
