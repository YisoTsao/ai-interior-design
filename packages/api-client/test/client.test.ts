import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from '../src/index.js';

describe('生成型別與契約同步', () => {
  it('src/schema.gen.ts 與 docs/specs/openapi.yaml 一致（不一致請跑 pnpm --filter @interiorai/api-client generate）', async () => {
    const spec = new URL('../../../docs/specs/openapi.yaml', import.meta.url);
    const fresh = astToString(await openapiTS(spec));
    const committed = await readFile(fileURLToPath(new URL('../src/schema.gen.ts', import.meta.url)), 'utf8');
    const body = (s: string) => s.slice(s.indexOf('export interface paths'));
    expect(body(committed)).toBe(body(fresh));
  });
});

describe('createApiClient', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('帶 token、路徑參數、Idempotency-Key', async () => {
    const f = vi.fn(async () => json(200, { id: 'p1', name: 'x', createdAt: '', updatedAt: '' }));
    const c = createApiClient({
      baseUrl: 'http://api/v1',
      getToken: () => 'T',
      fetch: f as unknown as typeof fetch,
    });
    const p = await c.get('/projects/{id}', { params: { id: 'p1' } });
    expect(p.name).toBe('x');
    await c.post('/credits/checkout', { body: { packageId: 'credits_50' }, idempotencyKey: 'k-12345678' });
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('http://api/v1/projects/p1');
    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe('Bearer T');
    expect((calls[1]![1].headers as Record<string, string>)['idempotency-key']).toBe('k-12345678');
  });

  it('錯誤轉成 ApiClientError；401 時 refresh 一次後重送', async () => {
    let n = 0;
    const f = vi.fn(async () =>
      n++ === 0
        ? json(401, { code: 'AUTH_REQUIRED', message: 'no', requestId: 'r' })
        : json(200, { balance: 3, frozen: false }),
    );
    const onUnauthorized = vi.fn(async () => true);
    const c = createApiClient({ baseUrl: '', fetch: f as unknown as typeof fetch, onUnauthorized });
    expect(await c.get('/credits')).toEqual({ balance: 3, frozen: false });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    const g = createApiClient({
      baseUrl: '',
      fetch: (async () =>
        json(409, {
          code: 'VERSION_CONFLICT',
          message: 'm',
          details: { latest: null },
          requestId: 'r',
        })) as typeof fetch,
    });
    await expect(g.get('/credits')).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    await expect(g.get('/credits')).rejects.toBeInstanceOf(ApiClientError);
  });
});
