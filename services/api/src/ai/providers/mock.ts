import {
  compositeOutsideMask,
  deterministicNoise,
  fillRegion,
  largestRegion,
  resize,
  rgba,
  shift,
  tauPx,
  type Gray,
} from '@interiorai/image-ops';
import { decodePng, encodePng } from '../png.js';
import {
  ProviderError,
  type CallCtx,
  type ImageProvider,
  type InpaintInput,
  type RenderInput,
} from './types.js';

export type MockMode = 'ok' | 'break_structure' | 'slow' | 'fail';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), rej(signal.reason)), { once: true });
  });

/**
 * 確定性 mock（05 §8、ADR-012 §6）；讓 CI 與 E2E 不需金鑰即可跑完整流程。結果一律「未校準」。
 * - ok：clay＋確定性雜訊（結構不變）
 * - break_structure：刪除最大 objectId 區塊（填周圍平均色）並整體平移 3τ → recall 必低於所有門檻
 * - slow：3 秒後同 ok（可被取消）
 * - fail：丟可重試的 503
 */
export class MockImageProvider implements ImageProvider {
  readonly id = 'mock' as const;
  readonly capabilities = { edit: true, mask: true, depthControl: true, maxRefs: 16, maxSize: 4096 };
  calls = 0;

  constructor(private readonly mode: () => MockMode = () => 'ok') {}

  async render(i: RenderInput, ctx: CallCtx) {
    const t0 = Date.now();
    this.calls++;
    const mode = this.mode();
    if (mode === 'fail') throw new ProviderError('PROVIDER_UNAVAILABLE', 'mock 503', true, 503);
    if (mode === 'slow') await sleep(3000, ctx.signal);
    const clay = decodePng(i.gbuffer.color);
    let out;
    if (mode === 'break_structure') {
      const ids = decodePng(i.gbuffer.objectId);
      const big = largestRegion(ids);
      const t = tauPx(clay.width, clay.height);
      out = shift(big === null ? clay : fillRegion(clay, ids, big), 3 * t, 3 * t);
    } else out = deterministicNoise(clay, i.seed, 6);
    // 回傳請求的輸出尺寸（與真實供應商一致；驗證時再縮回 G-buffer 尺寸）
    return {
      image: encodePng(resize(out, i.size.w, i.size.h)),
      model: ctx.model,
      costUsd: ctx.costUsd,
      latencyMs: Date.now() - t0,
      seedSupported: true,
    };
  }

  /** 遮罩內染色，並故意改動遮罩外（驗證合成會逐位元還原遮罩外） */
  async inpaint(i: InpaintInput, ctx: CallCtx) {
    const t0 = Date.now();
    this.calls++;
    if (this.mode() === 'fail') throw new ProviderError('PROVIDER_UNAVAILABLE', 'mock 503', true, 503);
    const base = decodePng(i.base);
    const alpha = decodePng(i.mask);
    const m: Gray = {
      width: alpha.width,
      height: alpha.height,
      data: new Uint8Array(alpha.width * alpha.height),
    };
    for (let k = 0; k < m.data.length; k++) m.data[k] = alpha.data[k * 4 + 3] === 0 ? 1 : 0;
    const tint = rgba(base.width, base.height);
    for (let k = 0; k < m.data.length; k++) tint.data.set([200, 120, 90, 255], k * 4);
    const noisy = deterministicNoise(base, i.seed, 20); // 遮罩外也被改 → 合成必須還原
    const out = compositeOutsideMask(noisy, tint, m);
    return {
      image: encodePng(out),
      model: ctx.model,
      costUsd: ctx.costUsd,
      latencyMs: Date.now() - t0,
      seedSupported: true,
    };
  }
}
