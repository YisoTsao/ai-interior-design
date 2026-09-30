import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../tokens.js';
import type { Db, Tx } from '../../db/db.js';
import { creditBalances, creditLedger } from '../../db/schema.js';
import { ApiError } from '../../common/errors.js';

export type LedgerReason = 'purchase' | 'reserve' | 'settle' | 'refund' | 'grant' | 'adjust';
export type LedgerRow = typeof creditLedger.$inferSelect;

interface AppendInput {
  orgId: string;
  delta: number;
  reason: LedgerReason;
  key: string;
  jobId?: string;
  meta?: Record<string, unknown>;
}

/**
 * 點數帳本（04 §6、ADR-014）。帳本 append-only；餘額快取只在同一交易內隨帳本更新。
 * 同 org 的所有寫入以 credit_balances 行鎖序列化 → 併發下餘額不為負、同一冪等鍵只入帳一次。
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 在呼叫端的交易內入帳；同鍵已存在 → 回傳既有列（replayed） */
  async append(tx: Tx, a: AppendInput): Promise<{ entry: LedgerRow; replayed: boolean }> {
    if (!Number.isInteger(a.delta)) throw new Error('delta 必須是整數');
    await tx.insert(creditBalances).values({ orgId: a.orgId }).onConflictDoNothing();
    const [bal] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.orgId, a.orgId))
      .for('update');
    const [existing] = await tx
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.orgId, a.orgId), eq(creditLedger.idempotencyKey, a.key)))
      .limit(1);
    if (existing) return { entry: existing, replayed: true };
    if (bal!.frozen && a.delta < 0)
      throw new ApiError('CREDITS_FROZEN', '點數帳戶對帳異常，暫停扣點；請聯絡客服', {
        reason: bal!.frozenReason,
      });
    const next = bal!.balance + a.delta;
    if (next < 0)
      throw new ApiError('INSUFFICIENT_CREDITS', '點數不足', { balance: bal!.balance, required: -a.delta });
    const [entry] = await tx
      .insert(creditLedger)
      .values({
        orgId: a.orgId,
        delta: a.delta,
        reason: a.reason,
        jobId: a.jobId,
        idempotencyKey: a.key,
        balanceAfter: next,
        meta: a.meta,
      })
      .returning();
    await tx
      .update(creditBalances)
      .set({ balance: next, updatedAt: sql`now()` })
      .where(eq(creditBalances.orgId, a.orgId));
    return { entry: entry!, replayed: false };
  }

  private async jobEntry(tx: Tx, orgId: string, jobId: string, reason: LedgerReason) {
    const [e] = await tx
      .select()
      .from(creditLedger)
      .where(
        and(eq(creditLedger.orgId, orgId), eq(creditLedger.jobId, jobId), eq(creditLedger.reason, reason)),
      )
      .limit(1);
    return e;
  }

  /** 預扣＝該 Job 最大成本（ADR-014） */
  reserve(tx: Tx, orgId: string, jobId: string, amount: number) {
    if (amount <= 0) throw new Error('預扣金額必須 > 0');
    return this.append(tx, { orgId, delta: -amount, reason: 'reserve', key: `${jobId}:reserve`, jobId });
  }

  /** 結算：只能退回差額（實際 ≤ 預扣，不補扣）；已退款的 Job 不能再結算 */
  async settle(tx: Tx, orgId: string, jobId: string, actual: number) {
    const reserve = await this.jobEntry(tx, orgId, jobId, 'reserve');
    if (!reserve) return null; // 免費任務
    if (await this.jobEntry(tx, orgId, jobId, 'refund'))
      throw new ApiError('CONFLICT', '此任務已退款，不能結算');
    const reserved = -reserve.delta;
    const charged = Math.max(0, Math.min(Math.round(actual), reserved));
    return this.append(tx, {
      orgId,
      delta: reserved - charged,
      reason: 'settle',
      key: `${jobId}:settle`,
      jobId,
      meta: { reserved, actual: charged, requested: actual },
    });
  }

  /** 失敗/取消：全額退回預扣；已結算的 Job 不能退款 */
  async refund(tx: Tx, orgId: string, jobId: string, meta?: Record<string, unknown>) {
    const reserve = await this.jobEntry(tx, orgId, jobId, 'reserve');
    if (!reserve) return null;
    if (await this.jobEntry(tx, orgId, jobId, 'settle'))
      throw new ApiError('CONFLICT', '此任務已結算，不能退款');
    return this.append(tx, {
      orgId,
      delta: -reserve.delta,
      reason: 'refund',
      key: `${jobId}:refund`,
      jobId,
      meta,
    });
  }

  grant(orgId: string, amount: number, key: string, meta?: Record<string, unknown>) {
    return this.db.tx(null, (tx) => this.append(tx, { orgId, delta: amount, reason: 'grant', key, meta }));
  }

  purchase(orgId: string, amount: number, key: string, meta?: Record<string, unknown>) {
    return this.db.tx(null, (tx) => this.append(tx, { orgId, delta: amount, reason: 'purchase', key, meta }));
  }

  async balance(orgId: string) {
    const [b] = await this.db.orm.select().from(creditBalances).where(eq(creditBalances.orgId, orgId));
    return { balance: b?.balance ?? 0, frozen: b?.frozen ?? false };
  }

  async page(orgId: string, limit: number, cursor?: string) {
    const rows = await this.db.orm
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.orgId, orgId), cursor ? lt(creditLedger.id, Number(cursor)) : undefined))
      .orderBy(desc(creditLedger.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return {
      items: items.map((r) => ({
        id: String(r.id),
        delta: r.delta,
        reason: r.reason,
        jobId: r.jobId,
        balanceAfter: r.balanceAfter,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? String(items.at(-1)!.id) : null,
    };
  }
}
