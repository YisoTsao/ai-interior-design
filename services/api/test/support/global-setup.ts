import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { ensureLoginRoles, migrate } from '../../src/db/migrate.js';
import { Db } from '../../src/db/db.js';
import { seedCatalog } from '../../src/db/seed.js';
import { Storage } from '../../src/infra/storage.js';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
    systemUrl: string;
    redisUrl: string;
    s3Endpoint: string;
    pgHost: string;
    pgPort: number;
  }
}

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let minio: StartedTestContainer;

export async function setup(project: TestProject) {
  [pg, redis, minio] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    // minio/minio 已不在 Docker Hub（ADR-018）
    new GenericContainer('bitnamilegacy/minio:latest')
      .withEnvironment({
        MINIO_ROOT_USER: 'minio',
        MINIO_ROOT_PASSWORD: 'minio12345',
        MINIO_DEFAULT_BUCKETS: 'interiorai',
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000).forStatusCode(200))
      .withStartupTimeout(120_000)
      .start(),
  ]);
  const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  // MINIO_DEFAULT_BUCKETS 在健康檢查通過後才非同步建立 → 自己確保（與 main.ts 相同）
  await new Storage({
    endpoint: s3Endpoint,
    publicEndpoint: s3Endpoint,
    region: 'us-east-1',
    bucket: 'interiorai',
    accessKeyId: 'minio',
    secretAccessKey: 'minio12345',
  }).ensureBucket();
  const ownerUrl = pg.getConnectionUri();
  await migrate(ownerUrl);
  await ensureLoginRoles(ownerUrl, {
    app: { user: 'app_login', password: 'app' },
    system: { user: 'system_login', password: 'system' },
  });
  const u = new URL(ownerUrl);
  const as = (user: string, pw: string) => {
    const x = new URL(ownerUrl);
    x.username = user;
    x.password = pw;
    return x.toString();
  };
  const appUrl = as('app_login', 'app');
  const seedDb = new Db(appUrl, 1);
  await seedCatalog(seedDb);
  await seedDb.close();

  project.provide('ownerUrl', ownerUrl);
  project.provide('appUrl', appUrl);
  project.provide('systemUrl', as('system_login', 'system'));
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('s3Endpoint', s3Endpoint);
  project.provide('pgHost', u.hostname);
  project.provide('pgPort', Number(u.port));
}

export async function teardown() {
  await Promise.allSettled([pg?.stop(), redis?.stop(), minio?.stop()]);
}
