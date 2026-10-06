import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../tokens.js';
import type { Db } from '../db/db.js';
import { auditLog } from '../db/schema.js';
import type { Req } from './context.js';
import { log } from './log.js';

/** 稽核（B9.7）：登入、匯出、分享、刪除、扣點、權限變更。寫入失敗不影響主流程，但會記錯誤日誌。 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    req: Req | null,
    e: {
      action: string;
      orgId?: string | null;
      userId?: string | null;
      targetType?: string;
      targetId?: string;
      meta?: Record<string, unknown>;
    },
  ) {
    try {
      await this.db.orm.insert(auditLog).values({
        orgId: e.orgId ?? req?.auth?.orgId ?? null,
        userId: e.userId ?? req?.auth?.userId ?? null,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        ip: req?.ip?.replace(/^::ffff:/, '') ?? null,
        userAgent: req?.header('user-agent')?.slice(0, 300) ?? null,
        meta: { ...e.meta, requestId: req?.requestId },
      });
    } catch (err) {
      log.error('audit.write_failed', { action: e.action, err: (err as Error).message });
    }
  }
}
