import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { DB, MODELS, STORAGE } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { creditLedger, jobs, orgs, projectVersions, projects, renders, uploads } from '../../db/schema.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { AuditService } from '../../common/audit.service.js';
import { ApiError, notFound } from '../../common/errors.js';
import type { ModelsConfig } from '../../ai/models.js';
import { isBlockedText, STYLES } from '../../ai/prompts/index.js';
import type { RenderJobInput } from '../../ai/render.processor.js';
import { LedgerService } from '../billing/ledger.service.js';
import { creditsFor } from '../billing/pricing.js';
import { JobsService, toJobDto, type JobRow } from '../jobs/jobs.service.js';
import { uuidParam } from '../projects/projects.controller.js';

type RenderRow = typeof renders.$inferSelect;

/**
 * AI 渲染 API（05、B6）。所有 AI 呼叫都在後端 worker（B6.1-1）；此處只建立任務、預扣點數、回傳結果 URL。
 */
@Controller()
export class RendersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(MODELS) private readonly models: ModelsConfig,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 每日 AI 任務上限（依方案，04 §3） */
  private async checkDailyLimit(orgId: string) {
    const [org] = await this.db.orm.select().from(orgs).where(eq(orgs.id, orgId));
    const limit = this.models.daily_job_limit[org?.plan ?? 'free'] ?? this.models.daily_job_limit.free ?? 50;
    const [row] = await this.db.tx(orgId, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(inArray(jobs.type, ['render', 'inpaint']), gte(jobs.createdAt, sql`date_trunc('day', now())`)),
        ),
    );
    if ((row?.n ?? 0) >= limit)
      throw new ApiError('RATE_LIMITED', `已達今日 AI 任務上限（${limit}）`, {
        limit,
        plan: org?.plan ?? 'free',
      });
  }

  @Get('pricing')
  pricing() {
    return {
      render: {
        '1k': creditsFor(this.models, 'render', '1k'),
        '2k': creditsFor(this.models, 'render', '2k'),
        '4k': creditsFor(this.models, 'render', '4k'),
      },
      inpaint: creditsFor(this.models, 'inpaint'),
      styles: Object.keys(STYLES),
    };
  }

  @Post('renders')
  @HttpCode(202)
  @MinRole('editor')
  async create(
    @Req() req: R,
    @Body()
    b: Omit<RenderJobInput, 'settings'> & {
      settings: RenderJobInput['settings'] & { confirmHighRes?: boolean };
    },
  ) {
    const a = authOf(req);
    if (isBlockedText(b.settings.extra)) throw new ApiError('MODERATION_BLOCKED', '額外要求含有不允許的內容');
    if (b.settings.resolution === '4k' && !b.settings.confirmHighRes)
      throw new ApiError('VALIDATION_FAILED', '4K 渲染需要確認（confirmHighRes: true）；建議先產生 1K 草圖');
    await this.checkDailyLimit(a.orgId);

    // 專案/版本屬於本組織（RLS）
    const [ver] = await this.db.tx(a.orgId, (tx) =>
      tx
        .select({ id: projectVersions.id })
        .from(projectVersions)
        .innerJoin(projects, eq(projects.id, projectVersions.projectId))
        .where(
          and(eq(projectVersions.id, b.versionId), eq(projects.id, b.projectId), isNull(projects.deletedAt)),
        ),
    );
    if (!ver) throw notFound('專案版本');
    const ids = Object.values(b.gbufferUploadIds);
    const ups = await this.db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.orgId, a.orgId), inArray(uploads.id, ids)));
    if (ups.length !== new Set(ids).size || ups.some((u) => u.kind !== 'gbuffer' || u.status !== 'uploaded'))
      throw new ApiError(
        'VALIDATION_FAILED',
        'G-buffer 必須是本組織已完成的 gbuffer 上傳（先呼叫 /uploads/{id}/complete）',
      );

    const cost = creditsFor(this.models, 'render', b.settings.resolution);
    const { confirmHighRes: _c, ...settings } = b.settings;
    const job = await this.jobs.create(
      a,
      {
        type: 'render',
        projectId: b.projectId,
        input: { ...b, settings } as unknown as Record<string, unknown>,
        costEstimate: cost,
      },
      async (tx, j) => {
        await tx.insert(renders).values({
          id: j.id,
          jobId: j.id,
          projectId: b.projectId,
          versionId: b.versionId,
          camera: b.camera,
          settings: settings as Record<string, unknown>,
        });
      },
    );
    await this.audit.record(req, {
      action: 'render.create',
      targetType: 'render',
      targetId: job.id,
      meta: { cost },
    });
    return toJobDto(job);
  }

  private async load(orgId: string, id: string): Promise<{ r: RenderRow; job: JobRow }> {
    const job = await this.jobs.get(orgId, uuidParam(id)); // RLS：跨租戶 → 404
    const [r] = await this.db.orm.select().from(renders).where(eq(renders.id, job.id));
    if (!r) throw notFound('渲染');
    return { r, job };
  }

  private async accepted(orgId: string, jobId: string) {
    const [e] = await this.db.orm
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(eq(creditLedger.orgId, orgId), eq(creditLedger.idempotencyKey, `${jobId}:accept-unvalidated`)),
      );
    return Boolean(e);
  }

  private async dto(orgId: string, r: RenderRow, job: JobRow) {
    const out = (job.output ?? {}) as {
      previewKey?: string;
      unvalidatedKey?: string;
      validation?: Record<string, unknown>;
    };
    const accepted =
      job.state === 'failed' && out.unvalidatedKey ? await this.accepted(orgId, job.id) : false;
    const key = r.outputKey ?? (accepted ? out.unvalidatedKey : undefined);
    const prov = job.provenance as { validation?: { threshold?: number; calibrated?: boolean } } | null;
    const settings = r.settings as { baseRenderId?: string };
    return {
      id: r.id,
      jobId: job.id,
      projectId: r.projectId,
      versionId: r.versionId,
      kind: job.type as 'render' | 'inpaint',
      baseRenderId: settings.baseRenderId ?? null,
      state: job.state,
      progress: job.progress,
      settings: r.settings,
      width: r.width,
      height: r.height,
      validation:
        r.validationScore !== null || r.validationPassed !== null
          ? {
              score: r.validationScore,
              passed: r.validationPassed,
              threshold: prov?.validation?.threshold ?? 0,
              calibrated: prov?.validation?.calibrated ?? false,
            }
          : null,
      outputUrl: key ? await this.storage.getUrl(key) : null,
      previewUrl: out.previewKey && !accepted ? await this.storage.getUrl(out.previewKey) : null,
      accepted,
      costCredits: job.costEstimateCredits,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      provenance: job.provenance ?? null,
    };
  }

  @Get('renders/:id')
  async get(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const { r, job } = await this.load(a.orgId, id);
    return this.dto(a.orgId, r, job);
  }

  @Post('renders/:id/cancel')
  @HttpCode(200)
  @MinRole('editor')
  async cancel(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const { job } = await this.load(a.orgId, id);
    return toJobDto(await this.jobs.cancel(a.orgId, job.id));
  }

  @Post('renders/:id/inpaint')
  @HttpCode(202)
  @MinRole('editor')
  async inpaint(
    @Req() req: R,
    @Param('id') id: string,
    @Body() b: { objectIds: string[]; instruction: string },
  ) {
    const a = authOf(req);
    const { r: base, job: baseJob } = await this.load(a.orgId, id);
    if (baseJob.state !== 'succeeded' || !base.outputKey)
      throw new ApiError('CONFLICT', '只能對已完成且通過驗證的渲染做局部重繪');
    if (isBlockedText(b.instruction)) throw new ApiError('MODERATION_BLOCKED', '重繪指示含有不允許的內容');
    const idMap = ((baseJob.input as { idMap?: Record<string, { id: string }> }).idMap ?? {}) as Record<
      string,
      { id: string }
    >;
    const visible = new Set(Object.values(idMap).map((v) => v.id));
    if (!b.objectIds.some((o) => visible.has(o)))
      throw new ApiError('VALIDATION_FAILED', '所選物件不在此渲染的畫面中');
    await this.checkDailyLimit(a.orgId);
    const cost = creditsFor(this.models, 'inpaint');
    const settings = { baseRenderId: base.id, objectIds: b.objectIds, instruction: b.instruction };
    const job = await this.jobs.create(
      a,
      { type: 'inpaint', projectId: base.projectId, input: settings, costEstimate: cost },
      async (tx, j) => {
        await tx.insert(renders).values({
          id: j.id,
          jobId: j.id,
          projectId: base.projectId,
          versionId: base.versionId,
          camera: base.camera,
          settings,
        });
      },
    );
    await this.audit.record(req, {
      action: 'render.inpaint',
      targetType: 'render',
      targetId: job.id,
      meta: { base: base.id, cost },
    });
    return toJobDto(job);
  }

  /** ADR-012 §5：以 adjust 扣回實際成本（冪等鍵 {jobId}:accept-unvalidated）後提供無浮水印下載 */
  @Post('renders/:id/accept')
  @HttpCode(200)
  @MinRole('editor')
  async accept(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const { r, job } = await this.load(a.orgId, id);
    const out = (job.output ?? {}) as { unvalidatedKey?: string };
    if (job.state !== 'failed' || !out.unvalidatedKey)
      throw new ApiError('CONFLICT', '只有未通過結構驗證的渲染可以選擇「仍要使用」');
    const { replayed } = await this.db.tx(null, (tx) =>
      this.ledger.append(tx, {
        orgId: a.orgId,
        delta: -job.costEstimateCredits,
        reason: 'adjust',
        key: `${job.id}:accept-unvalidated`,
        jobId: job.id,
        meta: { reason: 'accept-unvalidated' },
      }),
    );
    if (!replayed)
      await this.audit.record(req, {
        action: 'render.accept_unvalidated',
        targetType: 'render',
        targetId: job.id,
      });
    return this.dto(a.orgId, r, job);
  }
}
