import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 2 ** 15;
const R = 8;
const P = 1;
const LEN = 32;

/** scrypt（Node 內建，無原生依賴）：`scrypt$N$r$p$salt$hash`（base64url） */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  // 帳號不存在時仍做一次雜湊，避免以回應時間探測帳號是否存在
  const parts = (stored ?? DUMMY).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, 'base64url');
  const key = await scrypt(pw, Buffer.from(salt!, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return stored !== null && stored !== undefined && timingSafeEqual(key, expected);
}
const DUMMY = `scrypt$${N}$${R}$${P}$AAAAAAAAAAAAAAAAAAAAAA$${'A'.repeat(43)}`;
