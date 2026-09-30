import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface AppConfig {
  /** 應用程式連線（角色需為 interiorai_app 成員；受 RLS 約束） */
  databaseUrl: string;
  /** 維運工作連線（interiorai_system，BYPASSRLS）：僵屍預扣回收、對帳 */
  systemDatabaseUrl: string;
  redisUrl: string;
  s3: {
    endpoint: string;
    /** 回給瀏覽器的預簽名 URL 主機（容器內外位址不同時使用） */
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  cookieSecure: boolean;
  webhookSecret: string;
  signupGrantCredits: number;
  /** 回應也依 OpenAPI 驗證（測試/開發開啟；不符即 500） */
  strictResponses: boolean;
  rateLimit: { capacity: number; refillPerSec: number; loginCapacity: number; loginRefillPerSec: number };
  /** 任務逾時；僵屍預扣 = 未終態且超過 2× 逾時（ADR-014） */
  jobTimeoutMs: number;
  openapiPath: string;
  /** cv-service（Python，平面圖辨識） */
  cvServiceUrl: string;
  /**
   * 身分驗證模式：jwt＝需登入（Bearer JWT）；none＝不需登入，所有請求以固定的本機使用者／工作區處理。
   * 預設：development → none；test／production → jwt。之後改用 Supabase Auth 時新增 'supabase'。
   */
  authMode: 'none' | 'jwt';
  /** 物件儲存供應者：s3（S3 相容，含 MinIO）；supabase（介面已定義，尚未實作） */
  storageProvider: 's3' | 'supabase';
  supabase: { url: string | null; serviceRoleKey: string | null; bucket: string };
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** services/api/{src|dist}/config.* → repo 根目錄 */
export const REPO_ROOT = path.resolve(here, '../../..');

const req = (env: NodeJS.ProcessEnv, k: string, fallback?: string) => {
  const v = env[k] ?? fallback;
  if (v === undefined) throw new Error(`缺少環境變數 ${k}`);
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prod = env.NODE_ENV === 'production';
  // 開發預設值只在非 production 使用；production 必須全部由環境/Secret Manager 提供（B9.5）
  const dev = (v: string) => (prod ? undefined : v);
  const s3Endpoint = req(env, 'S3_ENDPOINT', dev('http://localhost:9000'));
  return {
    databaseUrl: req(
      env,
      'DATABASE_URL',
      dev('postgres://interiorai_app_login:app@localhost:5432/interiorai'),
    ),
    systemDatabaseUrl: req(
      env,
      'SYSTEM_DATABASE_URL',
      dev('postgres://interiorai_system_login:system@localhost:5432/interiorai'),
    ),
    redisUrl: req(env, 'REDIS_URL', dev('redis://localhost:6379')),
    s3: {
      endpoint: s3Endpoint,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? s3Endpoint,
      region: env.S3_REGION ?? 'us-east-1',
      bucket: req(env, 'S3_BUCKET', dev('interiorai')),
      accessKeyId: req(env, 'S3_ACCESS_KEY_ID', dev('minio')),
      secretAccessKey: req(env, 'S3_SECRET_ACCESS_KEY', dev('minio12345')),
    },
    jwtSecret: req(env, 'JWT_SECRET', dev('dev-only-secret-change-me-0123456789abcdef')),
    accessTtlSec: Number(env.ACCESS_TTL_SEC ?? 900),
    refreshTtlSec: Number(env.REFRESH_TTL_SEC ?? 30 * 24 * 3600),
    cookieSecure: prod,
    webhookSecret: req(env, 'PAYMENT_WEBHOOK_SECRET', dev('dev-webhook-secret')),
    signupGrantCredits: Number(env.SIGNUP_GRANT_CREDITS ?? 20),
    strictResponses: env.OPENAPI_STRICT_RESPONSES === '1' || (!prod && env.OPENAPI_STRICT_RESPONSES !== '0'),
    rateLimit: {
      capacity: Number(env.RATE_LIMIT_CAPACITY ?? 120),
      refillPerSec: Number(env.RATE_LIMIT_REFILL ?? 2),
      loginCapacity: Number(env.LOGIN_RATE_LIMIT_CAPACITY ?? 10),
      loginRefillPerSec: Number(env.LOGIN_RATE_LIMIT_REFILL ?? 0.1),
    },
    jobTimeoutMs: Number(env.JOB_TIMEOUT_MS ?? 5 * 60_000),
    openapiPath: env.OPENAPI_PATH ?? path.join(REPO_ROOT, 'docs/specs/openapi.yaml'),
    cvServiceUrl: env.CV_SERVICE_URL ?? 'http://localhost:8100',
    authMode:
      env.AUTH_MODE === 'none' || env.AUTH_MODE === 'jwt'
        ? env.AUTH_MODE
        : prod || env.NODE_ENV === 'test'
          ? 'jwt'
          : 'none',
    storageProvider: env.STORAGE_PROVIDER === 'supabase' ? 'supabase' : 's3',
    supabase: {
      url: env.SUPABASE_URL ?? null,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
      bucket: env.SUPABASE_BUCKET ?? 'interiorai',
    },
  };
}
