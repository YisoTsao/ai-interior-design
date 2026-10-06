import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { CONFIG, CONTRACT, DB } from '../tokens.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { memberships } from '../db/schema.js';
import { verifyAccess } from '../modules/auth/tokens.js';
import { LocalIdentity } from '../modules/auth/local-identity.js';
import { ROLE_RANK, type AuthContext, type Req } from './context.js';
import { ApiError } from './errors.js';
import type { OpenApiContract } from './openapi.js';
import type { TokenBucket } from './rate-limit.js';

export const RATE_LIMITER = Symbol('RATE_LIMITER');
const MIN_ROLE = 'minRole';
/** RBAC：此端點至少需要的組織角色（預設 viewer＝任何成員） */
export const MinRole = (r: AuthContext['role']) => SetMetadata(MIN_ROLE, r);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 全域 Guard（依序）：限流 → 驗證 Bearer JWT → X-Org-Id 切換（須為成員）→ RBAC。
 * 公開端點由 OpenAPI 的 `security: []` 決定（與契約同源）。
 */
@Injectable()
export class RequestGuard implements CanActivate {
  constructor(
    @Inject(CONTRACT) private readonly contract: OpenApiContract,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(RATE_LIMITER) private readonly limiter: TokenBucket,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LocalIdentity) private readonly local: LocalIdentity,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const op = this.contract.find(req.method, route);
    const ip = (req.ip ?? 'unknown').replace(/^::ffff:/, '');

    // 登入/註冊：以 IP 另設較嚴格的桶（防暴力破解）
    if (op && /^\/auth\/(login|register)$/.test(op.path)) {
      await this.limit(
        res,
        `login:${ip}`,
        this.config.rateLimit.loginCapacity,
        this.config.rateLimit.loginRefillPerSec,
      );
    }
    if (!op || op.public) {
      await this.limit(res, `ip:${ip}`, this.config.rateLimit.capacity, this.config.rateLimit.refillPerSec);
      return true;
    }

    const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    // 不需登入模式：沒有帶 token 的請求以本機使用者身分處理
    if (!m && this.config.authMode === 'none') {
      await this.limit(res, `ip:${ip}`, this.config.rateLimit.capacity, this.config.rateLimit.refillPerSec);
      req.auth = await this.local.get();
      return true;
    }
    const claims = m ? await verifyAccess(m[1]!, this.config.jwtSecret) : null;
    if (!claims) throw new ApiError('AUTH_REQUIRED', '請先登入');
    await this.limit(
      res,
      `u:${claims.sub}`,
      this.config.rateLimit.capacity,
      this.config.rateLimit.refillPerSec,
    );

    let auth: AuthContext = { userId: claims.sub, orgId: claims.org, role: claims.role };
    const want = req.header('x-org-id');
    if (want && want !== claims.org) {
      if (!UUID.test(want)) throw new ApiError('VALIDATION_FAILED', 'X-Org-Id 格式錯誤');
      const [mem] = await this.db.orm
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, want), eq(memberships.userId, claims.sub)));
      if (!mem) throw new ApiError('FORBIDDEN', '不是此組織的成員');
      auth = { userId: claims.sub, orgId: want, role: mem.role };
    }
    req.auth = auth;

    const need = this.reflector.getAllAndOverride<AuthContext['role'] | undefined>(MIN_ROLE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (need && ROLE_RANK[auth.role] < ROLE_RANK[need])
      throw new ApiError('FORBIDDEN', `需要 ${need} 以上權限`);
    return true;
  }

  private async limit(res: Response, key: string, cap: number, rate: number) {
    const r = await this.limiter.take(key, cap, rate);
    if (!r.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, r.retryAfterSec)));
      throw new ApiError('RATE_LIMITED', '請求過於頻繁，請稍後再試', { retryAfterSec: r.retryAfterSec });
    }
  }
}
