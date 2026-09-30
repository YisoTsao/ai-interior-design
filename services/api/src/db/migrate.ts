import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { REPO_ROOT } from '../config.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'db/migrations');

/** 依檔名順序套用 db/migrations/*.sql（每個檔一個交易）；以 schema_migrations 記錄已套用者 */
export async function migrate(ownerUrl: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    // 多個程序同時啟動時只讓一個跑遷移
    await client.query('SELECT pg_advisory_lock(727274)');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const body = await readFile(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`遷移 ${f} 失敗：${(e as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727274)');
    return applied;
  } finally {
    await client.end();
  }
}

/**
 * 建立可登入的應用/系統角色（開發與測試用；正式環境由 IaC 建立並把密碼放 Secret Manager）。
 */
export async function ensureLoginRoles(
  ownerUrl: string,
  roles: { app: { user: string; password: string }; system: { user: string; password: string } },
) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    for (const [r, group] of [
      [roles.app, 'interiorai_app'],
      [roles.system, 'interiorai_system'],
    ] as const) {
      const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [r.user])).rowCount;
      const ident = pg.escapeIdentifier(r.user);
      const pw = pg.escapeLiteral(r.password);
      await client.query(
        exists ? `ALTER ROLE ${ident} LOGIN PASSWORD ${pw}` : `CREATE ROLE ${ident} LOGIN PASSWORD ${pw}`,
      );
      await client.query(`GRANT ${group} TO ${ident}`);
      if (group === 'interiorai_system') await client.query(`ALTER ROLE ${ident} BYPASSRLS`);
    }
  } finally {
    await client.end();
  }
}
