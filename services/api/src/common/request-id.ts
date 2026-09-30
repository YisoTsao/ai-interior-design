import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { Req } from './context.js';

/** requestId：沿用可信任的上游 X-Request-Id（長度受限），否則產生新的；回寫到回應標頭 */
export function requestId(req: Req, res: Response, next: NextFunction) {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
