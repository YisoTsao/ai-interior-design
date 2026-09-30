import { Body, Controller, Get, HttpCode, Inject, Post, Param, Req } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, STORAGE } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { planImports, uploads } from '../../db/schema.js';
import type { Storage } from '../../infra/storage.js';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { ApiError, notFound } from '../../common/errors.js';
import { JobsService, toJobDto } from '../jobs/jobs.service.js';
import { uuidParam } from '../projects/projects.controller.js';

/** 平面圖匯入（06、S6.x）：建立辨識任務、取結果（校正 UI 用） */
@Controller()
export class PlanImportsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  @Post('plan-imports')
  @HttpCode(202)
  @MinRole('editor')
  async create(@Req() req: R, @Body() b: { uploadId: string; hints?: { scaleMmPerPx?: number } }) {
    const a = authOf(req);
    const [u] = await this.db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, b.uploadId), eq(uploads.orgId, a.orgId)));
    if (!u) throw notFound('上傳');
    if (u.kind !== 'plan' || u.status !== 'uploaded')
      throw new ApiError('VALIDATION_FAILED', 'uploadId 必須是已完成的平面圖上傳（kind=plan）');
    const job = await this.jobs.create(
      a,
      {
        type: 'plan_import',
        input: { uploadId: b.uploadId, ...(b.hints ? { hints: b.hints } : {}) },
        costEstimate: 0,
      },
      async (tx, j) => {
        await tx.insert(planImports).values({ id: j.id, jobId: j.id, uploadId: b.uploadId });
      },
    );
    return toJobDto(job);
  }

  @Get('plan-imports/:id')
  async get(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const job = await this.jobs.get(a.orgId, uuidParam(id)); // RLS：跨租戶 → 404
    const [row] = await this.db.orm.select().from(planImports).where(eq(planImports.id, job.id));
    if (!row) throw notFound('平面圖匯入');
    const [u] = await this.db.orm.select().from(uploads).where(eq(uploads.id, row.uploadId));
    const isImage = !!u && /^image\//.test(u.mime);
    return {
      id: row.id,
      jobId: job.id,
      state: job.state,
      progress: job.progress,
      source: (row.source as 'vector' | 'raster' | null) ?? null,
      fileName: u?.storageKey.split('/').pop() ?? null,
      sourceUrl: isImage && u ? await this.storage.getUrl(u.storageKey) : null,
      result: row.draftScene ?? null,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
    };
  }
}
