import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, eq, lt, sql } from 'drizzle-orm';
import { from, of, switchMap, tap, type Observable } from 'rxjs';
import { DB } from '../tokens.js';
import type { Db } from '../db/db.js';
import { idempotencyKeys } from '../db/schema.js';
import { sha256 } from '../modules/auth/tokens.js';
import { ApiError } from './errors.js';
import type { ReqWithOp } from './contract.interceptor.js';

const TTL_HOURS = 24;

/** 與鍵順序無關的 JSON（request_hash 用） */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * HTTP Idempotency-Key（04 §3、ADR-014 §3）：哪些端點需要由 OpenAPI 參數決定。
 * - 同 key、同內容 → 回放原回應（狀態碼＋本文）
 * - 同 key、不同內容 → 422 IDEMPOTENCY_KEY_REUSED
 * - 同 key 的請求還在處理 → 等待（最多 10 秒）後回放；仍未完成 → 409 CONFLICT
 * - 處理失敗（例外）→ 刪除紀錄，讓用戶端可用同 key 重試
 * - 24 小時後同 key 視為新請求（帳本冪等鍵綁 jobId，不受影響）
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<ReqWithOp>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (!req.op?.idempotent || !req.auth) return next.handle();
    const key = req.header('idempotency-key')!;
    const orgId = req.auth.orgId;
    const hash = sha256(
      `${req.method} ${req.originalUrl.split('?')[0]} ${req.auth.userId} ${stableStringify(req.body ?? null)}`,
    );
    const where = and(eq(idempotencyKeys.orgId, orgId), eq(idempotencyKeys.key, key));

    return from(this.begin(orgId, key, hash)).pipe(
      switchMap((prior) => {
        if (prior) {
          res.status(prior.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(prior.response);
        }
        return next.handle().pipe(
          tap({
            next: (body) =>
              void this.db.orm
                .update(idempotencyKeys)
                .set({ response: (body ?? null) as never, status: res.statusCode })
                .where(where)
                .execute(),
            error: () => void this.db.orm.delete(idempotencyKeys).where(where).execute(),
          }),
        );
      }),
    );
  }

  /** 取得 key；回 null 表示由本請求處理，否則回既有回應 */
  private async begin(
    orgId: string,
    key: string,
    hash: string,
  ): Promise<{ status: number; response: unknown } | null> {
    await this.db.orm
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.orgId, orgId),
          eq(idempotencyKeys.key, key),
          lt(idempotencyKeys.createdAt, sql`now() - make_interval(hours => ${TTL_HOURS})`),
        ),
      );
    const ins = await this.db.orm
      .insert(idempotencyKeys)
      .values({ orgId, key, requestHash: hash })
      .onConflictDoNothing()
      .returning();
    if (ins.length) return null;
    for (let i = 0; i < 100; i++) {
      const [row] = await this.db.orm
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.orgId, orgId), eq(idempotencyKeys.key, key)));
      if (!row) return this.begin(orgId, key, hash); // 前一個請求失敗並刪除了紀錄
      if (row.requestHash !== hash)
        throw new ApiError('IDEMPOTENCY_KEY_REUSED', '此 Idempotency-Key 已用於不同的請求內容');
      if (row.status !== null) return { status: row.status, response: row.response };
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new ApiError('CONFLICT', '相同 Idempotency-Key 的請求仍在處理中');
  }
}
