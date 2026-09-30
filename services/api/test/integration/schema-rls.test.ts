import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { REPO_ROOT } from '../../src/config.js';
import { Db } from '../../src/db/db.js';
import { TABLES, projects } from '../../src/db/schema.js';
import { createStack, register, type Stack } from '../support/stack.js';

let s: Stack;
/** Drizzle 把 pg 錯誤包成 "Failed query"；原始錯誤在 cause */
const pgErr = (p: Promise<unknown>) =>
  p.catch((e: Error & { cause?: Error }) => {
    throw e.cause ?? e;
  });
beforeAll(async () => {
  s = await createStack();
});
afterAll(() => s?.close());

/** 資料庫結構的正規化描述（欄位、索引、約束、RLS policy） */
async function describeDb(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const q = async (text: string) => (await c.query(text)).rows.map((r) => Object.values(r).join('|')).sort();
  const out = {
    columns: await q(`SELECT table_name, column_name, data_type, is_nullable, coalesce(column_default,'')
      FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'schema_migrations'`),
    indexes: await q(
      `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename <> 'schema_migrations'`,
    ),
    constraints:
      await q(`SELECT conrelid::regclass::text, contype, pg_get_constraintdef(oid) FROM pg_constraint
      WHERE connamespace='public'::regnamespace AND conrelid::regclass::text <> 'schema_migrations'`),
    policies: await q(`SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname='public'`),
    rls: await q(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname <> 'schema_migrations'`),
    triggers: await q(
      `SELECT event_object_table, trigger_name, event_manipulation FROM information_schema.triggers WHERE trigger_schema='public'`,
    ),
  };
  await c.end();
  return out;
}

describe('資料庫結構', () => {
  it('db/migrations 依序套用的結果與權威 db/schema.sql 相同', async () => {
    const owner = inject('ownerUrl');
    const admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS schema_ref');
    await admin.query('CREATE DATABASE schema_ref');
    await admin.end();
    const refUrl = Object.assign(new URL(owner), { pathname: '/schema_ref' }).toString();
    const ref = new pg.Client({ connectionString: refUrl });
    await ref.connect();
    await ref.query(await readFile(path.join(REPO_ROOT, 'db/schema.sql'), 'utf8'));
    await ref.end();
    expect(await describeDb(owner)).toEqual(await describeDb(refUrl));
  });

  it('Drizzle 表定義與資料庫欄位一致', async () => {
    for (const [name, table] of Object.entries(TABLES)) {
      const cols = (
        await s.owner.orm.execute<{ column_name: string }>(
          sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${name}`,
        )
      ).rows
        .map((r) => r.column_name)
        .sort();
      expect(
        getTableConfig(table)
          .columns.map((c) => c.name)
          .sort(),
        name,
      ).toEqual(cols);
    }
  });

  it('帳本 append-only：應用角色沒有 UPDATE/DELETE 權限；擁有者被 trigger 擋下', async () => {
    const u = await register(s.api);
    await expect(
      pgErr(s.appDb.orm.execute(sql`UPDATE credit_ledger SET delta = 999 WHERE org_id = ${u.orgId}`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pgErr(s.appDb.orm.execute(sql`DELETE FROM credit_ledger WHERE org_id = ${u.orgId}`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pgErr(s.owner.orm.execute(sql`UPDATE credit_ledger SET delta = 999 WHERE org_id = ${u.orgId}`)),
    ).rejects.toThrow(/append-only/);
  });

  it('應用角色不是表擁有者、不是 superuser、沒有 BYPASSRLS', async () => {
    const r = await s.appDb.orm.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const own = await s.appDb.orm.execute(
      sql`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner = current_user`,
    );
    expect(own.rows).toHaveLength(0);
  });
});

describe('RLS（第二道防線）', () => {
  it('未設定 app.org_id → projects/jobs 查無資料', async () => {
    const u = await register(s.api);
    const p = await s.api('POST', '/projects', { token: u.token, body: { name: 'rls' } });
    expect(p.status).toBe(201);
    const none = await s.appDb.tx(null, (tx) => tx.select().from(projects));
    expect(none).toHaveLength(0);
    const mine = await s.appDb.tx(u.orgId, (tx) => tx.select().from(projects));
    expect(mine.map((x) => x.id)).toContain(p.body.id);
  });

  it('跨租戶讀寫被擋：A 的交易看不到 B 的專案，也不能寫入 B 的 org_id', async () => {
    const a = await register(s.api, 'a');
    const b = await register(s.api, 'b');
    const pb = await s.api('POST', '/projects', { token: b.token, body: { name: 'b-secret' } });
    const seen = await s.appDb.tx(a.orgId, (tx) => tx.select().from(projects));
    expect(seen.map((x) => x.id)).not.toContain(pb.body.id);
    await expect(
      pgErr(
        s.appDb.tx(a.orgId, (tx) =>
          tx.insert(projects).values({ orgId: b.orgId, ownerId: a.userId, name: 'evil' }),
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // UPDATE 跨租戶：RLS 讓目標列不可見 → 影響 0 列
    const upd = await s.appDb.tx(a.orgId, (tx) =>
      tx.execute(sql`UPDATE projects SET name = 'pwned' WHERE id = ${pb.body.id}`),
    );
    expect(upd.rowCount).toBe(0);
    // API 層：B 的專案對 A 是 404
    expect((await s.api('GET', `/projects/${pb.body.id}`, { token: a.token })).status).toBe(404);
  });

  it('SET LOCAL 不會外洩到連線池中的下一個交易', async () => {
    const u = await register(s.api);
    const pool1 = new Db(inject('appUrl'), 1); // 單一連線 → 保證重用
    await pool1.tx(u.orgId, async () => undefined);
    const r = await pool1.orm.execute<{ v: string | null }>(
      sql`SELECT current_setting('app.org_id', true) AS v`,
    );
    expect(r.rows[0]!.v ?? '').toBe('');
    await pool1.close();
  });
});
