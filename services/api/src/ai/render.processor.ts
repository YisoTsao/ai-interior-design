import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  compositeOutsideMask,
  maskFromIds,
  maskToAlpha,
  resize,
  resizeMask,
  watermark,
  type RGBA,
} from '@interiorai/image-ops';
import type { Scene } from '@interiorai/scene-schema';
import type { Db } from '../db/db.js';
import { jobs, projectVersions, renders, uploads } from '../db/schema.js';
import type { Storage } from '../infra/storage.js';
import { JobFailure, type Processor, type ProcessorContext } from '../worker/runtime.js';
import type { ModelsConfig, Strictness } from './models.js';
import { decodePng, encodePng } from './png.js';
import {
  fill,
  loadTemplate,
  RETRY_NOTE,
  sanitizeUserExtra,
  STYLES,
  type PromptTemplate,
} from './prompts/index.js';
import { summarizeScene } from './prompts/scene-summary.js';
import { ProviderError, type ProviderResult } from './providers/types.js';
import { routeLabel, type ProviderRouter, type RouteCandidate, type RouteKind } from './router/index.js';
import { validateStructure, type ValidationResult } from './validation/index.js';
import { outputSize, type Resolution } from '../modules/billing/pricing.js';

export interface RenderJobInput {
  projectId: string;
  versionId: string;
  camera: Record<string, unknown>;
  gbufferUploadIds: { color: string; depth: string; edge: string; objectId: string; normal?: string };
  idMap?: Record<string, { id: string; kind: string }>;
  settings: { styleTemplateId: string; extra?: string; strictness: Strictness; resolution: Resolution };
}
export interface InpaintJobInput {
  baseRenderId: string;
  objectIds: string[];
  instruction: string;
}

export interface AiDeps {
  db: Db;
  storage: Storage;
  models: ModelsConfig;
  router: ProviderRouter;
  /** 呼叫層退避基準（測試可縮短） */
  backoffMs?: number;
}

const sha = (...b: (Buffer | string)[]) => {
  const h = createHash('sha256');
  b.forEach((x) => h.update(x));
  return h.digest('hex');
};
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), rej(signal.reason)), { once: true });
  });
const AI_TEXT = (jobId: string) => ({
  Software: 'InteriorAI',
  'AI-Generated': 'true',
  'InteriorAI-Job': jobId,
});

interface Attempt {
  layer: 'provider' | 'validation';
  ref: string;
  route: string;
  provider: string;
  seed: number;
  ok: boolean;
  error?: string;
  score?: number;
  costUsd?: number;
  latencyMs?: number;
}

export function createAiProcessors(deps: AiDeps): { render: Processor; inpaint: Processor } {
  const { db, storage, models, router } = deps;
  const backoff = deps.backoffMs ?? 500;
  const templates: Record<string, Promise<PromptTemplate>> = {};
  const tpl = (id: string) => (templates[id] ??= loadTemplate(id));

  /** 載入本組織已完成的上傳（org 條件＋狀態＋種類） */
  async function loadUploads(orgId: string, ids: string[]) {
    const rows = await db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.orgId, orgId), inArray(uploads.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return Promise.all(
      ids.map(async (id) => {
        const u = byId.get(id);
        if (!u || u.status !== 'uploaded' || u.kind !== 'gbuffer')
          throw new JobFailure('VALIDATION_FAILED', `G-buffer 上傳 ${id} 不存在或未完成`);
        return storage.get(u.storageKey);
      }),
    );
  }

  /**
   * 呼叫層（ADR-012 §2a）：同一供應商遇可重試錯誤以指數退避重試 provider_call_max 次（不計入 retry_count），
   * 仍失敗則換下一個候選；熔斷中者略過。每次呼叫前檢查成本硬上限。
   */
  async function callWithFallback(
    ctx: ProcessorContext,
    cands: RouteCandidate[],
    budget: { usd: number },
    attempts: Attempt[],
    seed: number,
    call: (c: RouteCandidate) => Promise<ProviderResult>,
  ): Promise<{ r: ProviderResult; c: RouteCandidate }> {
    let lastErr = '沒有可用的供應商';
    for (const c of cands) {
      const key = `${c.provider.id}:${c.ref}`;
      if (!router.breaker.available(key)) {
        attempts.push({
          layer: 'provider',
          ref: c.ref,
          route: c.route,
          provider: c.provider.id,
          seed,
          ok: false,
          error: 'circuit-open',
        });
        continue;
      }
      for (let k = 0; k <= models.retries.provider_call_max; k++) {
        if (budget.usd + c.costUsd > models.budgets.max_usd_per_job)
          throw new JobFailure('JOB_FAILED', `超過單一任務成本上限 US$${models.budgets.max_usd_per_job}`, {
            attempts,
          });
        try {
          const r = await call(c);
          router.breaker.success(key);
          budget.usd += r.costUsd;
          return { r, c };
        } catch (e) {
          if (ctx.signal.aborted) throw ctx.signal.reason;
          const pe =
            e instanceof ProviderError
              ? e
              : new ProviderError('PROVIDER_UNAVAILABLE', (e as Error).message, true);
          attempts.push({
            layer: 'provider',
            ref: c.ref,
            route: c.route,
            provider: c.provider.id,
            seed,
            ok: false,
            error: `${pe.code}:${pe.message}`.slice(0, 200),
          });
          if (pe.code === 'MODERATION_BLOCKED')
            throw new JobFailure('MODERATION_BLOCKED', '內容被供應商審核拒絕', { attempts });
          router.breaker.failure(key);
          lastErr = pe.message;
          if (!pe.retryable) break;
          if (k < models.retries.provider_call_max) await sleep(backoff * 2 ** k, ctx.signal);
        }
      }
    }
    throw new JobFailure('PROVIDER_UNAVAILABLE', `AI 供應商暫時無法使用：${lastErr}`, { attempts });
  }

  const outputKey = (orgId: string, projectId: string, renderId: string, name: string) =>
    `projects/${orgId}/${projectId}/renders/${renderId}/${name}`;

  const render: Processor = async (ctx) => {
    const { job } = ctx;
    const input = job.input as unknown as RenderJobInput;
    const orgId = job.orgId;
    const s = input.settings;
    const ids = input.gbufferUploadIds;
    const [color, depth, edge, objectId] = await loadUploads(orgId, [
      ids.color,
      ids.depth,
      ids.edge,
      ids.objectId,
    ]);
    const imgs = [color!, depth!, edge!, objectId!].map(decodePng);
    if (new Set(imgs.map((i) => `${i.width}x${i.height}`)).size !== 1)
      throw new JobFailure('VALIDATION_FAILED', 'G-buffer 各圖尺寸不一致');
    const gw = imgs[0]!.width;
    const gh = imgs[0]!.height;
    const edgeImg = imgs[2]!;
    await ctx.progress(10);

    const [ver] = await db.tx(orgId, (tx) =>
      tx.select().from(projectVersions).where(eq(projectVersions.id, input.versionId)),
    );
    if (!ver) throw new JobFailure('VALIDATION_FAILED', '找不到專案版本');
    const scene = JSON.parse((await storage.get(ver.sceneKey)).toString('utf8')) as Scene;
    const { roomType, materialList } = summarizeScene(scene);
    const size = outputSize(gw, gh, s.resolution);
    const gbufferHash = sha(color!, depth!, edge!, objectId!);
    const seed0 = parseInt(job.id.replace(/-/g, '').slice(0, 8), 16) % 1_000_000;

    const cands = router.available(s.strictness as RouteKind);
    const attempts: Attempt[] = [];
    const budget = { usd: 0 };
    let last: {
      out: RGBA;
      val: ValidationResult;
      c: RouteCandidate;
      prompt: ReturnType<typeof fill>;
      r: ProviderResult;
      seed: number;
    } | null = null;

    // 重新投遞（worker 當機/基礎設施錯誤後 BullMQ 重跑）時，從已用掉的 retry_count 繼續，
    // 驗證層重試總數仍受 validation_max 限制（ADR-012 §2b）
    const firstV = Math.min(job.retryCount, models.retries.validation_max);
    for (let v = firstV; v <= models.retries.validation_max; v++) {
      if (v > firstV) await ctx.retryValidation();
      // 第 2 次驗證重試：降級到下一條路線（通常是 strict／深度控制）；門檻不變（ADR-012 §1）
      const start = v >= 2 && cands.length > 1 ? 1 : 0;
      const seed = seed0 + v;
      const route = cands[start]!.route;
      const t = await tpl(route === 'B' ? 'render.strict' : 'render.balanced');
      const prompt = fill(t, {
        roomType,
        styleTemplate: STYLES[s.styleTemplateId] ?? s.styleTemplateId,
        materialList,
        lighting: 'soft natural daylight with realistic shadows',
        userExtra: sanitizeUserExtra(s.extra),
        retryNote: v >= 1 ? RETRY_NOTE : '',
      });
      const { r, c } = await callWithFallback(ctx, cands.slice(start), budget, attempts, seed, (cand) =>
        cand.provider.render(
          {
            gbuffer: { color: color!, depth: depth!, edge: edge!, objectId: objectId! },
            size,
            prompt: prompt.text,
            seed,
          },
          { signal: ctx.signal, model: cand.model, endpoint: cand.endpoint, costUsd: cand.costUsd },
        ),
      );
      await ctx.progress(40 + v * 15);
      await ctx.validating();
      const out = decodePng(r.image);
      if (out.width !== size.w || out.height !== size.h) {
        attempts.push({
          layer: 'validation',
          ref: c.ref,
          route: c.route,
          provider: c.provider.id,
          seed,
          ok: false,
          error: `尺寸不符 ${out.width}x${out.height}`,
        });
        continue; // 05 §6：尺寸不符視為該次呼叫失敗
      }
      const val = validateStructure(out, edgeImg, s.strictness, models.structure_validation, imgs[0]);
      attempts.push({
        layer: 'validation',
        ref: c.ref,
        route: c.route,
        provider: c.provider.id,
        seed,
        ok: val.passed,
        score: val.score,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
      });
      last = { out, val, c, prompt, r, seed };
      if (val.passed) break;
    }

    const provenance = (extra: Record<string, unknown> = {}) => ({
      provider: last?.c.provider.id ?? null,
      model: last?.r.model ?? null,
      route: last ? routeLabel(last.c.ref) : null,
      promptTemplateId: last?.prompt.templateId ?? null,
      promptTemplateVersion: last?.prompt.templateVersion ?? null,
      promptHash: last?.prompt.hash ?? null,
      sceneHash: ver.contentHash,
      gbufferHash,
      seed: last?.seed ?? seed0,
      seedSupported: last?.r.seedSupported ?? null,
      params: {
        strictness: s.strictness,
        resolution: s.resolution,
        styleTemplateId: s.styleTemplateId,
        size,
      },
      costUsd: Math.round(budget.usd * 10000) / 10000,
      latencyMs: last?.r.latencyMs ?? null,
      validation: last
        ? {
            score: last.val.score,
            passed: last.val.passed,
            threshold: last.val.threshold,
            calibrated: last.val.calibrated,
          }
        : null,
      attempts,
      at: new Date().toISOString(),
      ...extra,
    });

    if (!last) throw new JobFailure('JOB_FAILED', '供應商輸出尺寸不符', provenance());
    if (!last.val.passed) {
      // ADR-012 §4：失敗 → 保存無浮水印原圖（接受前不可下載）＋ 1K 浮水印預覽
      const small = outputSize(last.out.width, last.out.height, '1k');
      const unvalidatedKey = outputKey(orgId, input.projectId, job.id, 'out-unvalidated.png');
      const previewKey = outputKey(orgId, input.projectId, job.id, 'preview.png');
      await storage.put(unvalidatedKey, encodePng(last.out, AI_TEXT(job.id)), 'image/png');
      await storage.put(
        previewKey,
        encodePng(watermark(resize(last.out, small.w, small.h)), AI_TEXT(job.id)),
        'image/png',
      );
      await db.orm
        .update(renders)
        .set({
          validationScore: last.val.score,
          validationPassed: false,
          width: last.out.width,
          height: last.out.height,
        })
        .where(eq(renders.id, job.id));
      throw new JobFailure(
        'JOB_FAILED',
        `結構驗證未通過（${last.val.score} < ${last.val.threshold}）`,
        provenance(),
        { renderId: job.id, previewKey, unvalidatedKey, validation: provenance().validation },
      );
    }

    const key = outputKey(orgId, input.projectId, job.id, 'out.png');
    await storage.put(key, encodePng(last.out, AI_TEXT(job.id)), 'image/png');
    await db.orm
      .update(renders)
      .set({
        outputKey: key,
        width: last.out.width,
        height: last.out.height,
        validationScore: last.val.score,
        validationPassed: true,
      })
      .where(eq(renders.id, job.id));
    const prov = provenance();
    return {
      output: {
        renderId: job.id,
        outputKey: key,
        width: last.out.width,
        height: last.out.height,
        validation: prov.validation,
      },
      costActualCredits: job.costEstimateCredits,
      provenance: prov,
    };
  };

  const inpaint: Processor = async (ctx) => {
    const { job } = ctx;
    const input = job.input as unknown as InpaintJobInput;
    const orgId = job.orgId;
    // 基底渲染：同組織（jobs 受 RLS）、已成功
    const [baseJob] = await db.tx(orgId, (tx) =>
      tx.select().from(jobs).where(eq(jobs.id, input.baseRenderId)),
    );
    const [baseRender] = await db.orm.select().from(renders).where(eq(renders.id, input.baseRenderId));
    if (!baseJob || !baseRender?.outputKey)
      throw new JobFailure('VALIDATION_FAILED', '基底渲染不存在或未完成');
    const baseInput = baseJob.input as unknown as RenderJobInput;
    const basePng = await storage.get(baseRender.outputKey);
    const base = decodePng(basePng);
    const [idPng] = await loadUploads(orgId, [baseInput.gbufferUploadIds.objectId]);
    const ids = decodePng(idPng!);

    // 遮罩＝所選物件的 objectId 區域 → 膨脹 3px → 縮放到效果圖尺寸 → 透明＝要改（B6.2-2）
    const codes = Object.entries(baseInput.idMap ?? {})
      .filter(([, v]) => input.objectIds.includes(v.id))
      .map(([k]) => Number(k));
    if (!codes.length) throw new JobFailure('VALIDATION_FAILED', '所選物件不在此渲染的畫面中');
    const mask = resizeMask(maskFromIds(ids, codes, 3), base.width, base.height);
    const maskPng = encodePng(maskToAlpha(mask));
    if (maskPng.length >= 4 * 1024 * 1024) throw new JobFailure('VALIDATION_FAILED', '遮罩超過 4MB');
    await ctx.progress(20);

    const t = await tpl('inpaint');
    const prompt = fill(t, { instruction: sanitizeUserExtra(input.instruction) });
    const seed = parseInt(job.id.replace(/-/g, '').slice(0, 8), 16) % 1_000_000;
    const attempts: Attempt[] = [];
    const budget = { usd: 0 };
    const { r, c } = await callWithFallback(
      ctx,
      router.available('inpaint'),
      budget,
      attempts,
      seed,
      (cand) =>
        cand.provider.inpaint(
          { base: basePng, mask: maskPng, prompt: prompt.text, seed },
          { signal: ctx.signal, model: cand.model, endpoint: cand.endpoint, costUsd: cand.costUsd },
        ),
    );
    await ctx.progress(80);
    // 遮罩外像素還原（B6.2-3）：遮罩外逐位元等於基底圖
    const out = compositeOutsideMask(base, decodePng(r.image), mask);
    const key = outputKey(orgId, baseRender.projectId, job.id, 'out.png');
    await storage.put(key, encodePng(out, AI_TEXT(job.id)), 'image/png');
    await db.orm
      .update(renders)
      .set({ outputKey: key, width: out.width, height: out.height, validationPassed: true })
      .where(eq(renders.id, job.id));
    let maskedPixels = 0;
    for (const v of mask.data) maskedPixels += v;
    const prov = {
      provider: c.provider.id,
      model: r.model,
      route: routeLabel(c.ref),
      promptTemplateId: prompt.templateId,
      promptTemplateVersion: prompt.templateVersion,
      promptHash: prompt.hash,
      baseRenderId: input.baseRenderId,
      objectIds: input.objectIds,
      maskHash: sha(maskPng),
      maskedPixels,
      seed,
      seedSupported: r.seedSupported,
      costUsd: budget.usd,
      latencyMs: r.latencyMs,
      attempts,
      at: new Date().toISOString(),
    };
    return {
      output: {
        renderId: job.id,
        outputKey: key,
        width: out.width,
        height: out.height,
        baseRenderId: input.baseRenderId,
      },
      costActualCredits: job.costEstimateCredits,
      provenance: prov,
    };
  };

  return { render, inpaint };
}
