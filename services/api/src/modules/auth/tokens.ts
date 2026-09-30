import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthContext } from '../../common/context.js';

export interface AccessClaims {
  sub: string;
  org: string;
  role: AuthContext['role'];
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccess(c: AccessClaims, secret: string, ttlSec: number): Promise<string> {
  return new SignJWT({ org: c.org, role: c.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setIssuer('interiorai')
    .setAudience('interiorai-api')
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(key(secret));
}

export async function verifyAccess(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: 'interiorai',
      audience: 'interiorai-api',
    });
    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') return null;
    return { sub: payload.sub, org: payload.org, role: payload.role as AccessClaims['role'] };
  } catch {
    return null;
  }
}

/** refresh token：256-bit 隨機值；資料庫只存 SHA-256 */
export const newOpaqueToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
