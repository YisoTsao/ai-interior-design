import { sql } from 'drizzle-orm';
import type { Db } from '../../db/db.js';
import { log } from '../../common/log.js';

export interface ReconcileIssue {
  orgId: string;
  ledgerSum: number;
  lastBalanceAfter: number | null;
  cached: number | null;
}

/**
 * 對帳（ADR-014 §5）：帳本加總＝最後一筆 balance_after＝餘額快取，容差 0。
 * 不一致 → 告警＋凍結該 org 的新預扣（退款/入帳仍可進行）。以系統連線執行（跨租戶）。冪等。
 */
export async function reconcile(systemDb: Db): Promise<ReconcileIssue[]> {
  const rows = await systemDb.orm.execute<{
    org_id: string;
    ledger_sum: string | null;
    last_after: number | null;
    cached: number | null;
  }>(sql`
    WITH s AS (
      SELECT org_id, sum(delta)::bigint AS ledger_sum,
             (array_agg(balance_after ORDER BY id DESC))[1] AS last_after
      FROM credit_ledger GROUP BY org_id
    )
    SELECT coalesce(s.org_id, b.org_id) AS org_id, s.ledger_sum, s.last_after, b.balance AS cached
    FROM s FULL OUTER JOIN credit_balances b ON b.org_id = s.org_id`);
  const issues: ReconcileIssue[] = [];
  for (const r of rows.rows) {
    const sum = Number(r.ledger_sum ?? 0);
    const last = r.last_after ?? 0;
    const cached = r.cached ?? 0;
    if (sum === last && last === cached) continue;
    const issue = { orgId: r.org_id, ledgerSum: sum, lastBalanceAfter: r.last_after, cached: r.cached };
    issues.push(issue);
    log.error('ledger.reconcile.mismatch', { ...issue });
    await systemDb.orm.execute(sql`
      INSERT INTO credit_balances (org_id, balance, frozen, frozen_reason)
      VALUES (${r.org_id}, ${Math.max(0, cached)}, true, ${`reconcile mismatch: ledger=${sum} last=${last} cached=${cached}`})
      ON CONFLICT (org_id) DO UPDATE SET frozen = true, frozen_reason = excluded.frozen_reason, updated_at = now()`);
    await systemDb.orm.execute(sql`
      INSERT INTO audit_log (org_id, action, target_type, target_id, meta)
      VALUES (${r.org_id}, 'credits.frozen', 'org', ${r.org_id}, ${JSON.stringify(issue)}::jsonb)`);
  }
  return issues;
}
