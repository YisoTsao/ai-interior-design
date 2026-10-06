import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ErrorCode } from './errors.js';
import type { Req } from './context.js';
import { log } from './log.js';

const fromHttp: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Req>();
    const res = ctx.getResponse<Response>();
    let e: ApiError;
    if (err instanceof ApiError) e = err;
    else if (err instanceof HttpException) {
      const s = err.getStatus();
      e = new ApiError(fromHttp[s] ?? 'INTERNAL', err.message, undefined, s);
    } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
      e = new ApiError('VALIDATION_FAILED', 'JSON 格式錯誤', undefined, 400);
    } else {
      log.error('unhandled', { requestId: req.requestId, err: (err as Error)?.stack ?? String(err) });
      e = new ApiError('INTERNAL', '伺服器錯誤');
    }
    if (res.headersSent) return;
    res.status(e.status).json({
      code: e.code,
      message: e.message,
      ...(e.details !== undefined ? { details: e.details } : {}),
      requestId: req.requestId,
    });
  }
}
