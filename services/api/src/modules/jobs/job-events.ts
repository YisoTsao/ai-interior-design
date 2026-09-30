import type { Redis } from 'ioredis';
import { Subject, filter, type Observable } from 'rxjs';

export interface JobEvent {
  id: string;
  type: string;
  state: string;
  progress: number;
  costEstimateCredits: number;
  costActualCredits: number | null;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
}

const EVENTS = 'job-events';
const CANCEL = 'job-cancel';

/**
 * 任務事件匯流排（Redis pub/sub）：API 程序訂閱一次、在程序內多工給各 SSE 連線；
 * 取消訊號同樣走 pub/sub，讓執行中的 worker 立即中止（水平擴充時所有 worker 都會收到）。
 */
export class JobEvents {
  private readonly events$ = new Subject<JobEvent>();
  private readonly cancel$ = new Subject<string>();
  private started: Promise<unknown> | null = null;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  private start() {
    this.started ??= (async () => {
      this.sub.on('message', (ch: string, msg: string) => {
        if (ch === EVENTS) this.events$.next(JSON.parse(msg) as JobEvent);
        else if (ch === CANCEL) this.cancel$.next(msg);
      });
      await this.sub.subscribe(EVENTS, CANCEL);
    })();
    return this.started;
  }

  async ready() {
    await this.start();
  }

  publish(e: JobEvent) {
    return this.pub.publish(EVENTS, JSON.stringify(e));
  }
  signalCancel(jobId: string) {
    return this.pub.publish(CANCEL, jobId);
  }

  stream(jobId: string): Observable<JobEvent> {
    void this.start();
    return this.events$.pipe(filter((e) => e.id === jobId));
  }
  onCancel(jobId: string, fn: () => void): () => void {
    void this.start();
    const s = this.cancel$.pipe(filter((id) => id === jobId)).subscribe(fn);
    return () => s.unsubscribe();
  }

  async close() {
    this.events$.complete();
    this.cancel$.complete();
    await this.sub.quit().catch(() => undefined);
  }
}
