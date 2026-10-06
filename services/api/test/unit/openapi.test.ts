import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { OpenApiContract } from '../../src/common/openapi.js';

describe('OpenAPI 契約載入', async () => {
  const c = await OpenApiContract.load(loadConfig().openapiPath);

  it('每個 operation 都有 x-phase', () => {
    const doc = c.doc as { paths: Record<string, Record<string, { 'x-phase'?: string }>> };
    for (const [p, item] of Object.entries(doc.paths))
      for (const [m, op] of Object.entries(item))
        if (m !== 'parameters') expect(op['x-phase'], `${m} ${p}`).toMatch(/^P[0-8]$/);
  });

  it('Express 路徑對應到契約', () => {
    expect(c.find('POST', '/v1/projects/:id/restore/:versionId')?.path).toBe(
      '/projects/{id}/restore/{versionId}',
    );
    expect(c.find('GET', '/v1/projects')?.public).toBe(false);
    expect(c.find('POST', '/v1/auth/login')?.public).toBe(true);
    expect(c.find('POST', '/v1/renders')?.idempotent).toBe(true);
    expect(c.find('GET', '/v1/nope')).toBeUndefined();
  });

  it('請求本文依 JSON Schema 驗證（含外部 scene.schema.json）', () => {
    const save = c.find('POST', '/v1/projects/:id/versions')!;
    expect(save.validateBody!({ baseVersionId: null, scene: { nope: 1 } })).toBe(false);
    const create = c.find('POST', '/v1/projects')!;
    expect(create.validateBody!({ name: 'ok' })).toBe(true);
    expect(create.validateBody!({ name: '' })).toBe(false);
    expect(create.validateBody!({ name: 'x', extra: 1 })).toBe(false);
  });

  it('查詢參數型別轉換與上限', () => {
    const list = c.find('GET', '/v1/projects')!;
    const q: Record<string, unknown> = { limit: '10' };
    expect(list.validateQuery!(q)).toBe(true);
    expect(q.limit).toBe(10);
    expect(list.validateQuery!({ limit: '1000' })).toBe(false);
  });
});
