import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AUTH_PROVIDER, CONFIG, DB } from '../../tokens.js';
import type { AppConfig } from '../../config.js';
import type { Db } from '../../db/db.js';
import { memberships, orgs, refreshTokens, users } from '../../db/schema.js';
import { ApiError } from '../../common/errors.js';
import type { AuthContext } from '../../common/context.js';
import { LedgerService } from '../billing/ledger.service.js';
import type { AuthProvider } from './auth-provider.js';
import { newOpaqueToken, sha256, signAccess } from './tokens.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; displayName: string | null; locale: string };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async register(input: { email: string; password: string; displayName?: string; locale?: string }) {
    if (!this.provider.register) throw new ApiError('FORBIDDEN', '此身分供應者不支援註冊');
    const userId = await this.provider.register(input);
    // 個人工作區（org）＋ owner 身分 ＋ 註冊贈點（冪等鍵綁 userId）
    const orgId = await this.db.tx(null, async (tx) => {
      const [org] = await tx
        .insert(orgs)
        .values({ name: input.displayName ? `${input.displayName} 的工作區` : input.email })
        .returning({ id: orgs.id });
      await tx.insert(memberships).values({ orgId: org!.id, userId, role: 'owner' });
      return org!.id;
    });
    if (this.config.signupGrantCredits > 0)
      await this.ledger.grant(orgId, this.config.signupGrantCredits, `signup:${userId}`, {
        reason: 'signup',
      });
    return this.issue(userId);
  }

  async login(email: string, password: string) {
    const userId = await this.provider.verify(email, password);
    if (!userId) throw new ApiError('AUTH_REQUIRED', 'email 或密碼錯誤');
    return this.issue(userId);
  }

  /** 使用者第一個組織（依角色高低、建立順序）作為預設作用中組織 */
  async defaultMembership(userId: string): Promise<{ orgId: string; role: AuthContext['role'] }> {
    const rows = await this.db.orm
      .select({ orgId: memberships.orgId, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(orgs.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(orgs.createdAt));
    const rank = { owner: 0, admin: 1, editor: 2, viewer: 3 };
    const m = rows.sort((a, b) => rank[a.role] - rank[b.role])[0];
    if (!m) throw new ApiError('FORBIDDEN', '沒有任何組織');
    return m;
  }

  private async issue(userId: string, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const [u] = await this.db.orm.select().from(users).where(eq(users.id, userId));
    if (!u || u.deletedAt) throw new ApiError('AUTH_REQUIRED', '帳號不存在');
    const m = await this.defaultMembership(userId);
    const refreshToken = newOpaqueToken();
    await this.db.orm.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
    });
    return {
      accessToken: await signAccess(
        { sub: userId, org: m.orgId, role: m.role },
        this.config.jwtSecret,
        this.config.accessTtlSec,
      ),
      refreshToken,
      expiresIn: this.config.accessTtlSec,
      user: { id: u.id, email: u.email, displayName: u.displayName, locale: u.locale },
    };
  }

  /**
   * refresh token 輪替：每次換發都作廢舊 token。已被輪替過的 token 再次出現 → 視為竊用，撤銷整個 family。
   * 併發下同一 token 只有一個請求能輪替成功（條件式 UPDATE）。
   */
  async refresh(token: string): Promise<{ tokens: IssuedTokens; userId: string }> {
    const [row] = await this.db.orm
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(token)));
    if (!row) throw new ApiError('AUTH_REQUIRED', 'refresh token 無效');
    if (row.revokedAt) {
      if (row.replacedBy) await this.revokeFamily(row.familyId);
      throw new ApiError('AUTH_REQUIRED', 'refresh token 已失效，請重新登入', {
        reused: Boolean(row.replacedBy),
      });
    }
    if (row.expiresAt.getTime() < Date.now()) throw new ApiError('AUTH_REQUIRED', 'refresh token 已過期');
    const [won] = await this.db.orm
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!won) throw new ApiError('AUTH_REQUIRED', 'refresh token 已被使用');
    const tokens = await this.issue(row.userId, row.familyId);
    const [next] = await this.db.orm
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(tokens.refreshToken)));
    await this.db.orm.update(refreshTokens).set({ replacedBy: next!.id }).where(eq(refreshTokens.id, row.id));
    return { tokens, userId: row.userId };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const [row] = await this.db.orm
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(token)));
    if (row) await this.revokeFamily(row.familyId);
  }

  private revokeFamily(familyId: string) {
    return this.db.orm
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async me(a: AuthContext) {
    const [u] = await this.db.orm.select().from(users).where(eq(users.id, a.userId));
    if (!u) throw new ApiError('AUTH_REQUIRED', '帳號不存在');
    const rows = await this.db.orm
      .select({ id: orgs.id, name: orgs.name, plan: orgs.plan, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(orgs.id, memberships.orgId))
      .where(eq(memberships.userId, a.userId))
      .orderBy(asc(orgs.createdAt));
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      locale: u.locale,
      activeOrgId: a.orgId,
      orgs: rows,
    };
  }
}
