// E2E 用完整後端（不需雲端與金鑰）：Testcontainers 起 Postgres/Redis/MinIO → 遷移/角色/種子 →
// API（:3100）＋ 同程序 worker（AI_PROVIDER=mock）。Playwright 的 webServer 啟動它；程序結束時 Ryuk 會清掉容器。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import {
  Db,
  JobEvents,
  JobsService,
  LedgerService,
  MockVisionProvider,
  QUEUE_NAME,
  Storage,
  createAiRuntime,
  createApp,
  createPlanImportProcessor,
  createRedis,
  ensureLoginRoles,
  loadConfig,
  migrate,
  seedCatalog,
  startWorker,
} from '../dist/index.js';

const port = Number(process.env.E2E_API_PORT ?? 3100);
// cv-service（平面圖辨識，P5）：以 venv 的 uvicorn 啟動
const cvDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cv-service');
const cvPort = Number(process.env.E2E_CV_PORT ?? 8101);
const cv = spawn(path.join(cvDir, '.venv/bin/uvicorn'), ['app.main:app', '--host', '127.0.0.1', '--port', String(cvPort)], {
  cwd: cvDir,
  stdio: 'inherit',
});
const [pg, redis, minio] = await Promise.all([
  new PostgreSqlContainer('postgres:16-alpine').start(),
  new RedisContainer('redis:7-alpine').start(),
  new GenericContainer('bitnamilegacy/minio:latest')
    .withEnvironment({ MINIO_ROOT_USER: 'minio', MINIO_ROOT_PASSWORD: 'minio12345' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .withStartupTimeout(120_000)
    .start(),
]);
const owner = pg.getConnectionUri();
await migrate(owner);
await ensureLoginRoles(owner, {
  app: { user: 'app_login', password: 'app' },
  system: { user: 'system_login', password: 'system' },
});
const as = (u, p) => Object.assign(new URL(owner), { username: u, password: p }).toString();
const s3 = `http://localhost:${minio.getMappedPort(9000)}`;
const config = {
  ...loadConfig({ NODE_ENV: 'test' }),
  databaseUrl: as('app_login', 'app'),
  systemDatabaseUrl: as('system_login', 'system'),
  redisUrl: redis.getConnectionUrl(),
  s3: {
    endpoint: s3,
    publicEndpoint: s3,
    region: 'us-east-1',
    bucket: 'interiorai',
    accessKeyId: 'minio',
    secretAccessKey: 'minio12345',
  },
  strictResponses: true,
};
const storage = new Storage(config.s3);
await storage.ensureBucket();
const db = new Db(config.databaseUrl);
await seedCatalog(db);

process.env.CORS_ORIGINS = 'http://localhost:4173,http://localhost:5173';
const app = await createApp(config);
await app.listen(port);

const conn = createRedis(config.redisUrl);
const events = new JobEvents(conn, conn.duplicate());
await events.ready();
const jobs = new JobsService(db, new LedgerService(db), new Queue(QUEUE_NAME, { connection: conn }), events);
const ai = await createAiRuntime(
  { db, storage },
  { AI_PROVIDER: 'mock', AI_MOCK_MODE: process.env.AI_MOCK_MODE ?? 'ok' },
);
const cvServiceUrl = `http://127.0.0.1:${cvPort}`;
startWorker({ connection: conn, jobs, events, timeoutMs: config.jobTimeoutMs }, {
  ...ai.processors,
  plan_import: createPlanImportProcessor({ db, storage, cvServiceUrl, vision: new MockVisionProvider() }),
});
console.log(`e2e backend ready on http://localhost:${port}/v1`);

const stop = async () => {
  cv.kill('SIGTERM');
  await app.close().catch(() => undefined);
  await Promise.allSettled([pg.stop(), redis.stop(), minio.stop()]);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
