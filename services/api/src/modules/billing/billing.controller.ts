import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { CONFIG } from '../../tokens.js';
import type { AppConfig } from '../../config.js';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { AuditService } from '../../common/audit.service.js';
import { ApiError } from '../../common/errors.js';
import { LedgerService } from './ledger.service.js';

/** 〔假設〕點數方案；真實金流（綠界/Stripe）未串接＝未驗證（PROGRESS 阻礙表） */
export const PACKAGES = { credits_50: 50, credits_200: 200 } as const;

export const signPayload = (raw: Buffer | string, secret: string) =>
  createHmac('sha256', secret).update(raw).digest('hex');

@Controller()
export class BillingController {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('credits')
  credits(@Req() req: R) {
    return this.ledger.balance(authOf(req).orgId);
  }

  @Get('credits/ledger')
  entries(@Req() req: R, @Query() q: { limit?: number; cursor?: string }) {
    if (q.cursor && !/^\d+$/.test(q.cursor)) throw new ApiError('VALIDATION_FAILED', 'cursor 無效');
    return this.ledger.page(authOf(req).orgId, q.limit ?? 25, q.cursor);
  }

  /** mock 金流：回傳一個結帳 id；實際入帳只經由驗簽過的 webhook */
  @Post('credits/checkout')
  @HttpCode(200)
  @MinRole('admin')
  async checkout(@Req() req: R, @Body() b: { packageId: keyof typeof PACKAGES }) {
    const a = authOf(req);
    const checkoutId = `mock_${randomUUID()}`;
    await this.audit.record(req, {
      action: 'credits.checkout',
      targetType: 'org',
      targetId: a.orgId,
      meta: { packageId: b.packageId, credits: PACKAGES[b.packageId], checkoutId },
    });
    return { checkoutId, url: `https://payments.invalid/mock/${checkoutId}`, provider: 'mock' };
  }

  /** 金流 webhook：HMAC-SHA256(raw body) 驗簽；同一事件 id 以帳本冪等鍵保證只入帳一次 */
  @Post('webhooks/payments')
  @HttpCode(200)
  async webhook(@Req() req: R, @Body() b: { id: string; type: string; orgId: string; credits: number }) {
    const sig = req.header('x-signature') ?? '';
    const expected = signPayload(req.rawBody ?? Buffer.alloc(0), this.config.webhookSecret);
    const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) throw new ApiError('AUTH_REQUIRED', '簽章錯誤');
    const { replayed } = await this.ledger.purchase(b.orgId, b.credits, `payment:${b.id}`, { eventId: b.id });
    if (!replayed)
      await this.audit.record(req, {
        action: 'credits.purchase',
        orgId: b.orgId,
        targetType: 'org',
        targetId: b.orgId,
        meta: { eventId: b.id, credits: b.credits },
      });
    return { ok: true };
  }
}
