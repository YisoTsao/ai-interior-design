import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CONFIG } from '../../tokens.js';
import type { AppConfig } from '../../config.js';
import { authOf, type Req as R } from '../../common/context.js';
import { AuditService } from '../../common/audit.service.js';
import { ApiError } from '../../common/errors.js';
import { AuthService, type IssuedTokens } from './auth.service.js';

const COOKIE = 'rt';

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private send(res: Response, t: IssuedTokens) {
    res.cookie(COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: this.config.refreshTtlSec * 1000,
    });
    return t;
  }

  @Post('auth/register')
  @HttpCode(201)
  async register(
    @Req() req: R,
    @Body() b: { email: string; password: string; displayName?: string; locale?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.register({ ...b, email: b.email.toLowerCase() });
    await this.audit.record(req, {
      action: 'auth.register',
      userId: t.user.id,
      targetType: 'user',
      targetId: t.user.id,
    });
    return this.send(res, t);
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Req() req: R,
    @Body() b: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const t = await this.auth.login(b.email.toLowerCase(), b.password);
      await this.audit.record(req, {
        action: 'auth.login',
        userId: t.user.id,
        targetType: 'user',
        targetId: t.user.id,
      });
      return this.send(res, t);
    } catch (e) {
      if (e instanceof ApiError)
        await this.audit.record(req, { action: 'auth.login_failed', meta: { email: b.email.toLowerCase() } });
      throw e;
    }
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: R,
    @Body() b: { refreshToken?: string } | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = b?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[COOKIE];
    if (!token) throw new ApiError('AUTH_REQUIRED', '缺少 refresh token');
    try {
      const { tokens } = await this.auth.refresh(token);
      return this.send(res, tokens);
    } catch (e) {
      if (e instanceof ApiError && (e.details as { reused?: boolean } | undefined)?.reused)
        await this.audit.record(req, { action: 'auth.refresh_reuse_detected' });
      throw e;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @Req() req: R,
    @Body() b: { refreshToken?: string } | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(b?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/v1/auth' });
  }

  @Get('me')
  me(@Req() req: R) {
    return this.auth.me(authOf(req));
  }
}
