import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
export type Drizzle = NodePgDatabase<typeof schema>;

/**
 * 資料庫存取。租戶隔離（04 §2）：每個交易內 `SET LOCAL app.org_id`（set_config(..., true)），
 * 絕不用 session 級 SET → 連線被重用時不會外洩租戶。未設定時 RLS 讓 projects/jobs 查無資料。
 */
export class Db {
  readonly pool: pg.Pool;
  readonly orm: Drizzle;
  constructor(url: string, max = 10) {
    this.pool = new pg.Pool({ connectionString: url, max });
    this.orm = drizzle(this.pool, { schema });
  }
  /** 租戶交易：orgId 為 null 時不設定（只能碰沒有 RLS 的表，例如 users） */
  tx<T>(orgId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.orm.transaction(async (tx) => {
      if (orgId) await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
      return fn(tx);
    });
  }
  close() {
    return this.pool.end();
  }
}
