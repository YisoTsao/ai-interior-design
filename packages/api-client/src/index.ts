import type { components, paths } from './schema.gen.js';

export type { components, paths };
export type Schemas = components['schemas'];
export type ErrorCode = Schemas['ErrorCode'];

type Method = 'get' | 'post' | 'patch' | 'delete' | 'put';
type Op<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;
type JsonOf<T> = T extends { content: { 'application/json': infer B } } ? B : never;
type BodyOf<P extends keyof paths, M extends Method> =
  Op<P, M> extends { requestBody?: infer RB } ? JsonOf<NonNullable<RB>> : never;
type Ok<R> = { [K in keyof R]: K extends 200 | 201 | 202 ? JsonOf<R[K]> : never }[keyof R];
type ResOf<P extends keyof paths, M extends Method> = Op<P, M> extends { responses: infer R } ? Ok<R> : never;
type PathParams<P extends string> = P extends `${string}{${infer K}}${infer Rest}`
  ? { [k in K]: string } & PathParams<Rest>
  : unknown;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  getToken?: () => string | null | undefined;
  /** 401 時呼叫一次（例如以 refresh cookie 換新 token）；回傳 true 則重送 */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof fetch;
}

export interface RequestOptions<P extends string> {
  params?: PathParams<P>;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  orgId?: string;
  signal?: AbortSignal;
}

/**
 * 由 OpenAPI 產生型別的 API 用戶端（04 §1：前端型別由契約產生）。
 * 路徑、請求本文、成功回應都受 docs/specs/openapi.yaml 型別約束；錯誤統一為 ApiClientError。
 */
export function createApiClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  async function request<P extends keyof paths & string, M extends Method>(
    method: M,
    path: P,
    o: RequestOptions<P> & { body?: BodyOf<P, M> } = {},
    retried = false,
  ): Promise<ResOf<P, M>> {
    let url = path.replace(/\{(\w+)\}/g, (_, k: string) =>
      encodeURIComponent((o.params as Record<string, string>)[k]!),
    );
    const q = Object.entries(o.query ?? {}).filter(([, v]) => v !== undefined);
    if (q.length) url += '?' + new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString();
    const token = opts.getToken?.();
    let res: Response;
    try {
      res = await f(opts.baseUrl + url, {
        method: method.toUpperCase(),
        credentials: 'include',
        signal: o.signal,
        headers: {
          ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
          ...(o.orgId ? { 'x-org-id': o.orgId } : {}),
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    } catch (e) {
      throw new ApiClientError(0, 'NETWORK', (e as Error).message);
    }
    if (res.status === 401 && !retried && opts.onUnauthorized && (await opts.onUnauthorized()))
      return request(method, path, o, true);
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const e = (data ?? {}) as { code?: ErrorCode; message?: string; details?: unknown; requestId?: string };
      throw new ApiClientError(
        res.status,
        e.code ?? 'INTERNAL',
        e.message ?? res.statusText,
        e.details,
        e.requestId,
      );
    }
    return data as ResOf<P, M>;
  }
  return {
    request,
    get: <P extends keyof paths & string>(p: P, o?: RequestOptions<P>) => request('get', p, o as never),
    post: <P extends keyof paths & string>(p: P, o?: RequestOptions<P> & { body?: BodyOf<P, 'post'> }) =>
      request('post', p, o),
    patch: <P extends keyof paths & string>(p: P, o?: RequestOptions<P> & { body?: BodyOf<P, 'patch'> }) =>
      request('patch', p, o),
    del: <P extends keyof paths & string>(p: P, o?: RequestOptions<P>) => request('delete', p, o as never),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
