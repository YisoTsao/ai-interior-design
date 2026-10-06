import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStack, sampleScene, type Stack } from '../support/stack.js';

let s: Stack;
beforeAll(async () => {
  s = await createStack({ authMode: 'none' });
});
afterAll(() => s?.close());

describe('AUTH_MODE=none（不需登入）', () => {
  it('沒有 token 的請求以本機使用者處理：建專案、存版本、查點數', async () => {
    const p = await s.api('POST', '/projects', { body: { name: 'no-login' } });
    expect(p.status).toBe(201);
    const v = await s.api('POST', `/projects/${p.body.id}/versions`, {
      body: { baseVersionId: null, scene: sampleScene() },
    });
    expect(v.status).toBe(201);
    const c = await s.api('GET', '/credits');
    expect(c.status).toBe(200);
    expect(c.body.balance).toBeGreaterThanOrEqual(1000);
    const list = await s.api('GET', '/projects');
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(p.body.id);
  });
  it('本機身分只建立一次（重複請求、點數不重複發放）', async () => {
    const [a, b] = await Promise.all([s.api('GET', '/credits'), s.api('GET', '/credits')]);
    expect(a.body.balance).toBe(b.body.balance);
    const again = await s.api('GET', '/credits');
    expect(again.body.balance).toBe(a.body.balance);
  });
  it('本機使用者沒有密碼，無法用來登入', async () => {
    const r = await s.api('POST', '/auth/login', {
      body: { email: 'local@interiorai.local', password: 'anything-123' },
    });
    expect(r.status).toBe(401);
  });
});
