import 'reflect-metadata';
import { Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config.js';
import { AUTH_PROVIDER, CONFIG, CONTRACT, DB, MODELS, REDIS, STORAGE } from './tokens.js';
import { Db } from './db/db.js';
import { createRedis } from './infra/redis.js';
import { Storage } from './infra/storage.js';
import { OpenApiContract } from './common/openapi.js';
import { ApiExceptionFilter } from './common/exception.filter.js';
import { ContractInterceptor } from './common/contract.interceptor.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { RATE_LIMITER, RequestGuard } from './common/guard.js';
import { TokenBucket } from './common/rate-limit.js';
import { AuditService } from './common/audit.service.js';
import { requestId } from './common/request-id.js';
import { LocalAuthProvider } from './modules/auth/local-auth.provider.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { LedgerService } from './modules/billing/ledger.service.js';
import { BillingController } from './modules/billing/billing.controller.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { ProjectsController } from './modules/projects/projects.controller.js';
import { UploadsController } from './modules/uploads/uploads.controller.js';
import { AssetsController } from './modules/assets/assets.controller.js';
import { JobEvents } from './modules/jobs/job-events.js';
import { JOB_EVENTS, JOB_QUEUE, JobsService, QUEUE_NAME } from './modules/jobs/jobs.service.js';
import { JobAccessGuard, JobsController } from './modules/jobs/jobs.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { RendersController } from './modules/renders/renders.controller.js';
import { loadModels, type ModelsConfig } from './ai/models.js';

/** 關閉時釋放連線（app.close() 觸發） */
@Injectable()
class Lifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(JOB_QUEUE) private readonly queue: Queue,
    @Inject(JOB_EVENTS) private readonly events: JobEvents,
  ) {}
  async onApplicationShutdown() {
    await this.events.close();
    await this.queue.close();
    await this.redis.quit().catch(() => undefined);
    await this.db.close();
  }
}

export interface AppExtras {
  /** P4 起由 AI 模組加入的控制器與 provider */
  controllers?: DynamicModule['controllers'];
  providers?: DynamicModule['providers'];
}

@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    contract: OpenApiContract,
    models: ModelsConfig,
    extras: AppExtras = {},
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        ProjectsController,
        UploadsController,
        AssetsController,
        BillingController,
        JobsController,
        RendersController,
        ...(extras.controllers ?? []),
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: CONTRACT, useValue: contract },
        { provide: MODELS, useValue: models },
        { provide: DB, useFactory: () => new Db(config.databaseUrl) },
        { provide: REDIS, useFactory: () => createRedis(config.redisUrl) },
        { provide: STORAGE, useFactory: () => new Storage(config.s3) },
        { provide: RATE_LIMITER, useFactory: (r: Redis) => new TokenBucket(r), inject: [REDIS] },
        {
          provide: JOB_QUEUE,
          useFactory: (r: Redis) => new Queue(QUEUE_NAME, { connection: r }),
          inject: [REDIS],
        },
        { provide: JOB_EVENTS, useFactory: (r: Redis) => new JobEvents(r, r.duplicate()), inject: [REDIS] },
        LocalAuthProvider,
        { provide: AUTH_PROVIDER, useExisting: LocalAuthProvider },
        AuditService,
        LedgerService,
        AuthService,
        ProjectsService,
        JobsService,
        JobAccessGuard,
        Lifecycle,
        { provide: APP_GUARD, useClass: RequestGuard },
        // 順序即執行順序：先依契約驗證，再處理 Idempotency-Key
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        ...(extras.providers ?? []),
      ],
    };
  }
}

export async function createApp(config: AppConfig, extras: AppExtras = {}): Promise<NestExpressApplication> {
  const contract = await OpenApiContract.load(config.openapiPath);
  const models = await loadModels();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config, contract, models, extras),
    {
      rawBody: true,
      logger: process.env.LOG_LEVEL === 'silent' ? false : ['error', 'warn'],
    },
  );
  app.setGlobalPrefix('v1');
  app.use(requestId);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '10mb' });
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  app.enableShutdownHooks();
  return app;
}
