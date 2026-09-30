import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.js';
import { log } from '../common/log.js';
import type { JobsService } from '../modules/jobs/jobs.service.js';
import { reconcile } from '../modules/billing/reconcile.js';

/**
 * 僵屍預扣回收（ADR-014 §4）：未終態且超過 2× 逾時的 Job → failed＋退款。
 * 以系統連線（BYPASSRLS）跨租戶找候選，再用一般連線（SET LOCAL org）逐一轉換 → 冪等、可重複執行。
 */
export async function reapZombies(systemDb: Db, jobs: JobsService, timeoutMs: number) {
  const r = await systemDb.orm.execute<{ id: string; org_id: string }>(sql`
    SELECT id, org_id FROM jobs
    WHERE state IN ('queued','running','validating')
      AND coalesce(started_at, created_at) < now() - make_interval(secs => ${(2 * timeoutMs) / 1000})
    ORDER BY created_at LIMIT 500`);
  let reaped = 0;
  for (const row of r.rows) {
    const done = await jobs
      .fail(row.org_id, row.id, 'JOB_FAILED', '任務逾時未完成（回收）')
      .catch(() => null);
    if (done) reaped++;
  }
  if (reaped) log.warn('jobs.reaped', { count: reaped });
  return reaped;
}

export { reconcile };
