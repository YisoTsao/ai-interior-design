import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { memberships, orgs, users } from '../../db/schema.js';
import type { AuthContext } from '../../common/context.js';
import { LedgerService } from '../billing/ledger.service.js';

export const LOCAL_EMAIL = 'local@interiorai.local';
/** 本機工作區的開發用點數（冪等：只在第一次建立時發放） */
export const LOCAL_CREDITS = 1000;

/**
 * 不需登入模式（AUTH_MODE=none）的固定身分：第一次使用時建立本機使用者（沒有密碼，無法用來登入）、
 * 個人工作區與 owner 身分，並發放開發用點數。之後改用 Supabase Auth 時此模式只保留給本機開發。
 */
@Injectable()
export class LocalIdentity {
  private cached: Promise<AuthContext> | null = null;
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  get(): Promise<AuthContext> {
    this.cached ??= this.ensure().catch((e: unknown) => {
      this.cached = null;
      throw e;
    });
    return this.cached;
  }

  private async ensure(): Promise<AuthContext> {
    await this.db.orm
      .insert(users)
      .values({ email: LOCAL_EMAIL, displayName: 'Local', passwordHash: null })
      .onConflictDoNothing();
    const [u] = await this.db.orm.select({ id: users.id }).from(users).where(eq(users.email, LOCAL_EMAIL));
    if (!u) throw new Error('無法建立本機使用者');
    const [m] = await this.db.orm
      .select({ orgId: memberships.orgId })
      .from(memberships)
      .where(eq(memberships.userId, u.id));
    let orgId = m?.orgId;
    if (!orgId)
      orgId = await this.db.tx(null, async (tx) => {
        const [org] = await tx.insert(orgs).values({ name: '本機工作區' }).returning({ id: orgs.id });
        await tx.insert(memberships).values({ orgId: org!.id, userId: u.id, role: 'owner' });
        return org!.id;
      });
    await this.ledger.grant(orgId, LOCAL_CREDITS, `local:${u.id}`, { reason: 'local-dev' });
    return { userId: u.id, orgId, role: 'owner' };
  }
}
