import { Queue, UnrecoverableError, Worker, type Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';
import { ApiError } from '../common/errors.js';
import { log } from '../common/log.js';
import type { JobEvents } from '../modules/jobs/job-events.js';
import { isTerminal } from '../modules/jobs/job-state.js';
import {
  DEAD_QUEUE_NAME,
  QUEUE_NAME,
  type JobPayload,
  type JobResult,
  type JobRow,
  type JobsService,
} from '../modules/jobs/jobs.service.js';

export interface ProcessorContext {
  job: JobRow;
  /** 取消或逾時時 abort；processor 必須把它傳給外部呼叫（fetch 等） */
  signal: AbortSignal;
  progress(p: number): Promise<void>;
  /** 結構驗證（ADR-012）用：進入 validating／驗證失敗後回到 running 並 retry_count+1 */
  validating(): Promise<void>;
  retryValidation(): Promise<void>;
}
export type Processor = (ctx: ProcessorContext) => Promise<JobResult>;

/** 業務失敗（不重試）：processor 丟出後 Job 直接 failed＋退款 */
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly provenance?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface WorkerDeps {
  connection: Redis;
  jobs: JobsService;
  events: JobEvents;
  timeoutMs: number;
}

/**
 * BullMQ worker（04 §5）：逾時、取消訊號、失敗退款、死信佇列、可水平擴充（多個程序共用同一佇列）、
 * 冪等（重複投遞時 Job 已終態 → 直接略過；帳本鍵綁 jobId 不會重複扣款）。
 * BullMQ 的 attempts 只處理基礎設施層失敗（程序當機、未預期例外）；業務失敗用 JobFailure 直接結束。
 */
export function startWorker(
  deps: WorkerDeps,
  processors: Partial<Record<string, Processor>>,
  concurrency = 4,
) {
  const dead = new Queue(DEAD_QUEUE_NAME, { connection: deps.connection });
  const worker = new Worker<JobPayload>(
    QUEUE_NAME,
    async (bj: BullJob<JobPayload>) => {
      const { jobId, orgId } = bj.data;
      const current = await deps.jobs.get(orgId, jobId).catch(() => null);
      if (!current || isTerminal(current.state)) return { skipped: true };
      const proc = processors[bj.name];
      if (!proc) throw new UnrecoverableError(`沒有 ${bj.name} 的 processor`);
      const running = await deps.jobs.markRunning(orgId, jobId);
      if (!running) return { skipped: true }; // 已被取消

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new JobFailure('JOB_FAILED', '任務逾時')), deps.timeoutMs);
      const off = deps.events.onCancel(jobId, () => ac.abort(new JobFailure('CANCELED', '使用者取消')));
      try {
        const result = await Promise.race([
          proc({
            job: running,
            signal: ac.signal,
            progress: async (p) => void (await deps.jobs.progress(orgId, jobId, p)),
            validating: async () => void (await deps.jobs.markValidating(orgId, jobId)),
            retryValidation: async () => void (await deps.jobs.retryValidation(orgId, jobId)),
          }),
          new Promise<never>((_, reject) =>
            ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true }),
          ),
        ]);
        await deps.jobs.succeed(orgId, jobId, result);
        return { ok: true };
      } catch (e) {
        if (e instanceof JobFailure) {
          // 取消：API 端已轉 canceled 並退款，這裡只要停下來（不進死信）
          if (e.code === 'CANCELED') return { canceled: true };
          await deps.jobs.fail(orgId, jobId, e.code, e.message, e.provenance);
          throw new UnrecoverableError(e.message);
        }
        if (e instanceof ApiError) {
          await deps.jobs.fail(orgId, jobId, e.code, e.message);
          throw new UnrecoverableError(e.message);
        }
        throw e; // 交給 BullMQ 重試
      } finally {
        clearTimeout(timer);
        off();
      }
    },
    { connection: deps.connection, concurrency },
  );

  worker.on('failed', (bj, err) => {
    if (!bj) return;
    const final = err instanceof UnrecoverableError || bj.attemptsMade >= (bj.opts.attempts ?? 1);
    if (!final) return;
    void (async () => {
      // 死信：保留原始 payload 與錯誤供人工檢查；Job 若尚未終態 → failed＋退款
      await dead.add(bj.name, { ...bj.data, error: err.message, attemptsMade: bj.attemptsMade });
      await deps.jobs.fail(bj.data.orgId, bj.data.jobId, 'JOB_FAILED', err.message).catch(() => undefined);
      log.warn('job.dead', { jobId: bj.data.jobId, error: err.message, attempts: bj.attemptsMade });
    })();
  });
  worker.on('error', (err) => log.error('worker.error', { err: err.message }));

  return {
    worker,
    dead,
    async close() {
      await worker.close();
      await dead.close();
    },
  };
}
