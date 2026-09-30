import { Queue, Worker } from 'bullmq';
import {
  Db,
  JobEvents,
  JobsService,
  LedgerService,
  QUEUE_NAME,
  createRedis,
  loadConfig,
  log,
  reapZombies,
  reconcile,
  startWorker,
  type Processor,
} from '@interiorai/api';

/**
 * Worker 程序（04 §5）：可水平擴充（多開幾個程序即可，BullMQ 以 Redis 分派），
 * 另跑兩個維運排程：僵屍預扣回收（每分鐘）、帳本對帳（每 10 分鐘）。
 * P4 起在 processors 註冊 render / inpaint。
 */
const config = loadConfig();
const connection = createRedis(config.redisUrl);
const db = new Db(config.databaseUrl);
const systemDb = new Db(config.systemDatabaseUrl, 2);
const events = new JobEvents(connection, connection.duplicate());
const queue = new Queue(QUEUE_NAME, { connection });
const jobs = new JobsService(db, new LedgerService(db), queue, events);

const processors: Record<string, Processor> = {};
const main = startWorker(
  { connection, jobs, events, timeoutMs: config.jobTimeoutMs },
  processors,
  Number(process.env.WORKER_CONCURRENCY ?? 4),
);

const maintenance = new Queue('maintenance', { connection });
await maintenance.upsertJobScheduler('reap-zombies', { every: 60_000 }, { name: 'reap' });
await maintenance.upsertJobScheduler('reconcile-ledger', { every: 10 * 60_000 }, { name: 'reconcile' });
const maint = new Worker(
  'maintenance',
  async (j) => {
    if (j.name === 'reap') return { reaped: await reapZombies(systemDb, jobs, config.jobTimeoutMs) };
    if (j.name === 'reconcile') return { issues: (await reconcile(systemDb)).length };
    return null;
  },
  { connection, concurrency: 1 },
);

log.info('worker.started', { processors: Object.keys(processors) });

const shutdown = async () => {
  await Promise.allSettled([main.close(), maint.close()]);
  await Promise.allSettled([maintenance.close(), queue.close(), events.close()]);
  await Promise.allSettled([db.close(), systemDb.close(), connection.quit()]);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
