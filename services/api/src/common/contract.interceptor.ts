import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import { CONFIG, CONTRACT } from '../tokens.js';
import type { AppConfig } from '../config.js';
import type { Req } from './context.js';
import { ApiError } from './errors.js';
import { log } from './log.js';
import { formatErrors, type OpenApiContract, type Operation } from './openapi.js';

export type ReqWithOp = Req & { op?: Operation };

/**
 * 依 OpenAPI 驗證請求（本文、查詢參數、Idempotency-Key）；strictResponses 時也驗證回應本文。
 * 路由不在契約內 → 500（契約測試也會抓到）。
 */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  constructor(
    @Inject(CONTRACT) private readonly contract: OpenApiContract,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<ReqWithOp>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const op = this.contract.find(req.method, route);
    if (!op) throw new ApiError('INTERNAL', `路由不在 API 契約內：${req.method} ${route}`);
    req.op = op;

    const hasBody =
      req.body !== undefined && !(typeof req.body === 'object' && Object.keys(req.body).length === 0);
    if (op.bodyRequired && !hasBody) throw new ApiError('VALIDATION_FAILED', '缺少請求本文');
    if (op.validateBody && hasBody && !op.validateBody(req.body)) {
      const errs = op.validateBody.errors ?? [];
      // Scene 的數量上限（ADR-013 LIMITS，scene.schema.json 的 maxItems）→ 專用錯誤碼
      const overLimit = errs.some((e) => e.keyword === 'maxItems' && e.instancePath.startsWith('/scene'));
      throw new ApiError(
        overLimit ? 'SCENE_LIMIT_EXCEEDED' : 'VALIDATION_FAILED',
        overLimit ? 'Scene 超過數量上限' : '請求本文不符合契約',
        formatErrors(errs),
      );
    }
    if (op.validateQuery) {
      const q = { ...(req.query as Record<string, unknown>) };
      if (!op.validateQuery(q))
        throw new ApiError('VALIDATION_FAILED', '查詢參數不符合契約', formatErrors(op.validateQuery.errors));
      Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true });
    }
    if (op.idempotent) {
      const k = req.header('idempotency-key');
      if (!k || k.length < 8 || k.length > 128)
        throw new ApiError('VALIDATION_FAILED', '此端點需要 Idempotency-Key 標頭（8–128 字元）');
    }

    return next.handle().pipe(
      map((body) => {
        if (!this.config.strictResponses) return body;
        const v = op.responses.get(res.statusCode);
        if (v === undefined) {
          log.error('contract.response.status', { op: `${op.method} ${op.path}`, status: res.statusCode });
          throw new ApiError('INTERNAL', `回應狀態 ${res.statusCode} 不在契約內（${op.method} ${op.path}）`);
        }
        if (v && !v(body)) {
          log.error('contract.response.body', {
            op: `${op.method} ${op.path}`,
            errors: formatErrors(v.errors),
          });
          throw new ApiError('INTERNAL', `回應不符合契約（${op.method} ${op.path}）`, formatErrors(v.errors));
        }
        return body;
      }),
    );
  }
}
