export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'VERSION_CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'UPLOAD_REJECTED'
  | 'MODERATION_BLOCKED'
  | 'JOB_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'SCHEMA_UNSUPPORTED'
  | 'SCENE_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SCALE_UNKNOWN'
  | 'CONFLICT'
  | 'CREDITS_FROZEN'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  VERSION_CONFLICT: 409,
  INSUFFICIENT_CREDITS: 402,
  RATE_LIMITED: 429,
  UPLOAD_REJECTED: 422,
  MODERATION_BLOCKED: 422,
  JOB_FAILED: 422,
  PROVIDER_UNAVAILABLE: 503,
  SCHEMA_UNSUPPORTED: 422,
  SCENE_LIMIT_EXCEEDED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  SCALE_UNKNOWN: 422,
  CONFLICT: 409,
  CREDITS_FROZEN: 423,
  INTERNAL: 500,
};

/** 統一錯誤（B7）：回應格式 `{ code, message, details?, requestId }` */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: number,
  ) {
    super(message);
    this.status = status ?? STATUS[code];
  }
}

export const notFound = (what = '資源') => new ApiError('NOT_FOUND', `找不到${what}`);
