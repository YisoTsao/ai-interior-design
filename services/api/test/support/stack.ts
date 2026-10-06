import { inject } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createApp } from '../../src/app.module.js';
import { Db } from '../../src/db/db.js';
import { createRedis } from '../../src/infra/redis.js';
import { JobEvents } from '../../src/modules/jobs/job-events.js';
import { JobsService, QUEUE_NAME } from '../../src/modules/jobs/jobs.service.js';
import { LedgerService } from '../../src/modules/billing/ledger.service.js';
import { startWorker, type Processor } from '../../src/worker/runtime.js';

export interface Stack {
  config: AppConfig;
  app: NestExpressApplication;
  base: string;
  /** 擁有者連線（superuser；只用於測試佈置與竄改） */
  owner: Db;
  /** 應用程式角色連線（受 RLS） */
  appDb: Db;
  system: Db;
  jobs: JobsService;
  ledger: LedgerService;
  api: Api;
  startWorker(processors: Record<string, Processor>, concurrency?: number): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}
export type Api = <T = any>(
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string },
) => Promise<ApiResponse<T>>;

let n = 0;
/** 每個測試檔各自一份 Redis 前綴空間：用不同 db index 避免佇列互相干擾 */
export async function createStack(over: Partial<AppConfig> = {}): Promise<Stack> {
  const redisUrl = `${inject('redisUrl')}/${(n++ % 15) + 1}`;
  const config: AppConfig = {
    ...loadConfig({ NODE_ENV: 'test' }),
    databaseUrl: inject('appUrl'),
    systemDatabaseUrl: inject('systemUrl'),
    redisUrl,
    s3: {
      endpoint: inject('s3Endpoint'),
      publicEndpoint: inject('s3Endpoint'),
      region: 'us-east-1',
      bucket: 'interiorai',
      accessKeyId: 'minio',
      secretAccessKey: 'minio12345',
    },
    strictResponses: true,
    rateLimit: { capacity: 10_000, refillPerSec: 1000, loginCapacity: 1000, loginRefillPerSec: 100 },
    ...over,
  };
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}/v1`;
  const owner = new Db(inject('ownerUrl'), 2);
  const appDb = new Db(config.databaseUrl, 4);
  const system = new Db(config.systemDatabaseUrl, 2);
  const redis = createRedis(redisUrl);
  await redis.flushdb();
  const events = new JobEvents(redis, redis.duplicate());
  const queue = new Queue(QUEUE_NAME, { connection: redis });
  const ledger = new LedgerService(appDb);
  const jobs = new JobsService(appDb, ledger, queue, events);

  const api: Api = async (method, path, o = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(o.body !== undefined || o.raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...o.headers,
      },
      body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON（SSE 等） */
    }
    return { status: r.status, body: body as any, headers: r.headers };
  };

  const closers: (() => Promise<unknown>)[] = [];
  return {
    config,
    app,
    base,
    owner,
    appDb,
    system,
    jobs,
    ledger,
    api,
    async startWorker(processors, concurrency = 4) {
      const wRedis = createRedis(redisUrl);
      const wEvents = new JobEvents(wRedis, wRedis.duplicate());
      await wEvents.ready();
      const w = startWorker(
        {
          connection: wRedis,
          jobs: new JobsService(appDb, ledger, queue, wEvents),
          events: wEvents,
          timeoutMs: config.jobTimeoutMs,
        },
        processors,
        concurrency,
      );
      const stop = async () => {
        await w.close();
        await wEvents.close();
        await wRedis.quit().catch(() => undefined);
      };
      closers.push(stop);
      return stop;
    },
    async close() {
      for (const c of closers) await c().catch(() => undefined);
      await queue.close();
      await events.close();
      await redis.quit().catch(() => undefined);
      await app.close();
      await Promise.all([owner.close(), appDb.close(), system.close()]);
    },
  };
}

let userSeq = 0;
/** 註冊新使用者（各自的個人組織） */
export async function register(api: Api, prefix = 'u') {
  const email = `${prefix}${Date.now()}_${userSeq++}@test.local`;
  const r = await api('POST', '/auth/register', {
    body: { email, password: 'password-123', displayName: prefix },
  });
  if (r.status !== 201) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  const me = await api('GET', '/me', { token: r.body.accessToken });
  return {
    email,
    token: r.body.accessToken as string,
    refreshToken: r.body.refreshToken as string,
    userId: r.body.user.id as string,
    orgId: me.body.activeOrgId as string,
  };
}

export const sampleScene = (walls = 4) => ({
  schemaVersion: '1.0.0',
  units: 'mm',
  levels: [
    {
      id: 'lvl_1',
      elevation: 0,
      height: 2800,
      walls: Array.from({ length: walls }, (_, i) => ({
        id: `w_${i}`,
        a: [i * 1000, 0],
        b: [i * 1000 + 1000, 0],
        thickness: 100,
      })),
      openings: [],
      rooms: [],
      objects: [],
    },
  ],
});

export const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error(`until timeout; last=${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/**
 * 預簽名 PUT（測試用）：MinIO 偶爾關掉閒置的 keep-alive 連線，undici 重用時會 "other side closed"
 * → 連線層錯誤重試（不重試 HTTP 錯誤狀態）。
 */
export async function fetchRetry(url: string, init?: RequestInit) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}
export const putObject = (url: string, headers: Record<string, string>, body: Uint8Array | Buffer) =>
  fetchRetry(url, { method: 'PUT', headers, body: new Uint8Array(body) });
