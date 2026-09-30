import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
}
export type Req = Request & { requestId: string; auth?: AuthContext; rawBody?: Buffer };

export const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const;

/** 取得已驗證的使用者（Guard 已保證存在） */
export function authOf(req: Req): AuthContext {
  if (!req.auth) throw new Error('auth context missing');
  return req.auth;
}
