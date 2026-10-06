import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { users } from '../../db/schema.js';
import { ApiError } from '../../common/errors.js';
import type { AuthProvider } from './auth-provider.js';
import { hashPassword, verifyPassword } from './password.js';

@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';
  constructor(@Inject(DB) private readonly db: Db) {}

  async verify(email: string, password: string) {
    const [u] = await this.db.orm.select().from(users).where(eq(users.email, email)).limit(1);
    const ok = await verifyPassword(password, u && !u.deletedAt ? u.passwordHash : null);
    return ok && u ? u.id : null;
  }

  async register(input: { email: string; password: string; displayName?: string; locale?: string }) {
    const passwordHash = await hashPassword(input.password);
    const rows = await this.db.orm
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        locale: input.locale ?? 'zh-TW',
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!rows[0]) throw new ApiError('CONFLICT', '此 email 已註冊');
    return rows[0].id;
  }
}
