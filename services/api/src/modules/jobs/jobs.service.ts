import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DB } from '../../tokens.js';
import type { Db, Tx } from '../../db/db.js';
import { jobs } from '../../db/schema.js';
import { ApiError, notFound } from '../../common/errors.js';
import { LedgerService } from '../billing/ledger.service.js';
import type { JobEvent, JobEvents } from './job-events.js';
import { TERMINAL, isTerminal, sourcesOf, type JobState, type JobType } from './job-state.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const JOB_EVENTS = Symbol('JOB_EVENTS');
export const QUEUE_NAME = 'jobs';
export const DEAD_QUEUE_NAME = 'jobs-dead';

export type JobRow = typeof jobs.$inferSelect;
export interface JobPayload {
  jobId: string;
  orgId: string;
}
export interface JobResult {
  output: Record<string, unknown>;
  costActualCredits: number;
  provenance?: Record<string, unknown>;
}

export const toJobDto = (j: JobRow): JobEvent => ({
  id: j.id,
  type: j.type,
  state: j.state,
  progress: j.progress,
  costEstimateCredits: j.costEstimateCredits,
  costActualCredits: j.costActualCredits,
  retryCount: j.retryCount,
  errorCode: j.errorCode,
  errorMessage: j.errorMessage,
  output: j.output ?? null,
  createdAt: j.createdAt.toISOString(),
  finishedAt: j.finishedAt?.toISOString() ?? null,
});

/**
 * 任務（04 §5）。建立＋預扣在同一交易；成功＋結算、失敗/取消＋退款也各在同一交易 →
 * 帳本與任務狀態不會不一致。狀態轉換一律用條件式 UPDATE（state = ANY(允許的來源)），併發安全。
 */
@Injectable()
export class JobsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(JOB_QUEUE) private readonly queue: Queue<JobPayload>,
    @Inject(JOB_EVENTS) private readonly events: JobEvents,
  ) {}

  async create(
    a: { orgId: string; userId: string },
    j: { type: JobType; projectId?: string; input: Record<string, unknown>; costEstimate: number },
    inTx?: (tx: Tx, job: JobRow) => Promise<void>,
  ): Promise<JobRow> {
    const job = await this.db.tx(a.orgId, async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          orgId: a.orgId,
          userId: a.userId,
          projectId: j.projectId,
          type: j.type,
          input: j.input,
          costEstimateCredits: j.costEstimate,
        })
        .returning();
      if (j.costEstimate > 0) await this.ledger.reserve(tx, a.orgId, row!.id, j.costEstimate);
      if (inTx) await inTx(tx, row!);
      return row!;
    });
    // 提交後才入列；入列失敗時 Job 停在 queued，由僵屍回收在 2× 逾時後標 failed 並退款
    await this.queue.add(
      j.type,
      { jobId: job.id, orgId: a.orgId },
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    await this.events.publish(toJobDto(job));
    return job;
  }

  async get(orgId: string, id: string): Promise<JobRow> {
    const [row] = await this.db.tx(orgId, (tx) => tx.select().from(jobs).where(eq(jobs.id, id)));
    if (!row) throw notFound('任務');
    return row;
  }

  /** 條件式轉換；不允許（或已被其他程序轉走）時回 null */
  async transition(
    tx: Tx,
    id: string,
    to: JobState,
    patch: Partial<typeof jobs.$inferInsert> = {},
  ): Promise<JobRow | null> {
    const [row] = await tx
      .update(jobs)
      .set({ ...patch, state: to, ...(TERMINAL.includes(to) ? { finishedAt: sql`now()` } : {}) })
      .where(and(eq(jobs.id, id), inArray(jobs.state, sourcesOf(to))))
      .returning();
    return row ?? null;
  }

  private async emit(row: JobRow | null) {
    if (row) await this.events.publish(toJobDto(row));
    return row;
  }

  markRunning(orgId: string, id: string) {
    return this.db
      .tx(orgId, (tx) =>
        this.transition(tx, id, 'running', { startedAt: sql`coalesce(started_at, now())` as never }),
      )
      .then((r) => this.emit(r));
  }

  markValidating(orgId: string, id: string) {
    return this.db.tx(orgId, (tx) => this.transition(tx, id, 'validating')).then((r) => this.emit(r));
  }

  /** 結構驗證層重試（ADR-012）：validating → running，retry_count + 1 */
  retryValidation(orgId: string, id: string) {
    return this.db
      .tx(orgId, (tx) => this.transition(tx, id, 'running', { retryCount: sql`retry_count + 1` as never }))
      .then((r) => this.emit(r));
  }

  async progress(orgId: string, id: string, progress: number) {
    const p = Math.max(0, Math.min(100, Math.round(progress)));
    const [row] = await this.db.tx(orgId, (tx) =>
      tx
        .update(jobs)
        .set({ progress: p })
        .where(and(eq(jobs.id, id), notInArray(jobs.state, [...TERMINAL])))
        .returning(),
    );
    return this.emit(row ?? null);
  }

  succeed(orgId: string, id: string, r: JobResult) {
    return this.db
      .tx(orgId, async (tx) => {
        const row = await this.transition(tx, id, 'succeeded', {
          progress: 100,
          output: r.output,
          costActualCredits: r.costActualCredits,
          provenance: r.provenance,
        });
        if (row) await this.ledger.settle(tx, orgId, id, r.costActualCredits);
        return row;
      })
      .then((x) => this.emit(x));
  }

  fail(orgId: string, id: string, code: string, message: string, provenance?: Record<string, unknown>) {
    return this.db
      .tx(orgId, async (tx) => {
        const row = await this.transition(tx, id, 'failed', {
          errorCode: code,
          errorMessage: message.slice(0, 500),
          ...(provenance ? { provenance } : {}),
        });
        if (row) await this.ledger.refund(tx, orgId, id, { code });
        return row;
      })
      .then((x) => this.emit(x));
  }

  async cancel(orgId: string, id: string): Promise<JobRow> {
    const row = await this.db.tx(orgId, async (tx) => {
      const r = await this.transition(tx, id, 'canceled', {
        errorCode: 'CANCELED',
        errorMessage: '使用者取消',
      });
      if (r) await this.ledger.refund(tx, orgId, id, { code: 'CANCELED' });
      return r;
    });
    if (!row) {
      const cur = await this.get(orgId, id);
      if (isTerminal(cur.state)) throw new ApiError('CONFLICT', `任務已是終態（${cur.state}），無法取消`);
      throw new ApiError('CONFLICT', '任務狀態已改變，請重試');
    }
    await this.events.signalCancel(id);
    // 還在佇列中的直接移除；執行中的由 worker 收到取消訊號後中止
    await this.queue.remove(id).catch(() => undefined);
    await this.emit(row);
    return row;
  }
}
