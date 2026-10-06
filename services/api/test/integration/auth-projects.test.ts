import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStack, register, sampleScene, type Stack } from '../support/stack.js';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
afterAll(() => s?.close());

describe('Auth', () => {
  it('登入：錯誤密碼與不存在帳號回同樣的 401；成功設定 httpOnly refresh cookie', async () => {
    const u = await register(s.api);
    const bad = await s.api('POST', '/auth/login', { body: { email: u.email, password: 'wrong-password' } });
    const none = await s.api('POST', '/auth/login', {
      body: { email: 'nobody@test.local', password: 'wrong-password' },
    });
    expect([bad.status, none.status]).toEqual([401, 401]);
    expect(bad.body.message).toBe(none.body.message);
    expect(bad.body.requestId).toBeTruthy();
    const ok = await s.api('POST', '/auth/login', {
      body: { email: u.email.toUpperCase(), password: 'password-123' },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/rt=.*HttpOnly/i);
  });

  it('refresh 輪替；重用舊 token → 401 並撤銷整個 family', async () => {
    const u = await register(s.api);
    const r1 = await s.api('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);
    const reuse = await s.api('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    expect(reuse.status).toBe(401);
    // 竊用偵測：連新 token 也失效
    const r2 = await s.api('POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
    expect(r2.status).toBe(401);
    const audit = await s.owner.orm.execute(
      sql`SELECT 1 FROM audit_log WHERE action = 'auth.refresh_reuse_detected'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('logout 撤銷 refresh token；未帶 token 呼叫受保護端點 → 401 AUTH_REQUIRED', async () => {
    const u = await register(s.api);
    expect((await s.api('POST', '/auth/logout', { body: { refreshToken: u.refreshToken } })).status).toBe(
      204,
    );
    expect((await s.api('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } })).status).toBe(
      401,
    );
    const r = await s.api('GET', '/projects');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('AUTH_REQUIRED');
    expect((await s.api('GET', '/projects', { token: 'garbage' })).status).toBe(401);
  });

  it('重複註冊 → 409；請求本文不符契約 → 422 VALIDATION_FAILED（附欄位）', async () => {
    const u = await register(s.api);
    expect(
      (await s.api('POST', '/auth/register', { body: { email: u.email, password: 'password-123' } })).status,
    ).toBe(409);
    const bad = await s.api('POST', '/auth/register', { body: { email: 'not-an-email', password: 'short' } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.body.details.length).toBeGreaterThan(0);
  });

  it('RBAC：viewer 可讀不可寫；非成員切換組織 → 403', async () => {
    const owner = await register(s.api, 'owner');
    const viewer = await register(s.api, 'viewer');
    await s.owner.orm.execute(
      sql`INSERT INTO memberships (org_id, user_id, role) VALUES (${owner.orgId}, ${viewer.userId}, 'viewer')`,
    );
    const p = await s.api('POST', '/projects', { token: owner.token, body: { name: 'shared' } });
    const h = { 'x-org-id': owner.orgId };
    const list = await s.api('GET', '/projects', { token: viewer.token, headers: h });
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(p.body.id);
    const w = await s.api('POST', '/projects', { token: viewer.token, headers: h, body: { name: 'nope' } });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe('FORBIDDEN');
    const stranger = await register(s.api, 'stranger');
    expect((await s.api('GET', '/projects', { token: stranger.token, headers: h })).status).toBe(403);
  });
});

describe('Projects / Versions', () => {
  it('建立、分頁、改名、刪除', async () => {
    const u = await register(s.api);
    for (let i = 0; i < 5; i++) await s.api('POST', '/projects', { token: u.token, body: { name: `p${i}` } });
    const p1 = await s.api('GET', '/projects?limit=2', { token: u.token });
    expect(p1.body.items).toHaveLength(2);
    const p2 = await s.api('GET', `/projects?limit=2&cursor=${p1.body.nextCursor}`, { token: u.token });
    const p3 = await s.api('GET', `/projects?limit=2&cursor=${p2.body.nextCursor}`, { token: u.token });
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((x) => x.name);
    expect(new Set(all).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
    const id = p1.body.items[0].id;
    expect(
      (await s.api('PATCH', `/projects/${id}`, { token: u.token, body: { name: 'renamed' } })).body.name,
    ).toBe('renamed');
    expect((await s.api('DELETE', `/projects/${id}`, { token: u.token })).status).toBe(204);
    expect((await s.api('GET', `/projects/${id}`, { token: u.token })).status).toBe(404);
    expect((await s.api('GET', '/projects/not-a-uuid', { token: u.token })).status).toBe(404);
  });

  it('樂觀鎖：base 不符 → 409 VERSION_CONFLICT 附最新版本；相同內容 → 200 不新增版本', async () => {
    const u = await register(s.api);
    const p = (await s.api('POST', '/projects', { token: u.token, body: { name: 'v' } })).body;
    const v1 = await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: { baseVersionId: null, scene: sampleScene(2) },
    });
    expect(v1.status).toBe(201);
    expect(v1.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const v2 = await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: { baseVersionId: v1.body.id, scene: sampleScene(3) },
    });
    expect(v2.status).toBe(201);
    expect(v2.body.parentVersionId).toBe(v1.body.id);
    // 另一個分頁還拿著 v1 當 base
    const stale = await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: { baseVersionId: v1.body.id, scene: sampleScene(4) },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    expect(stale.body.details.latest.id).toBe(v2.body.id);
    // 鍵順序不同但內容相同 → 同一雜湊
    const same = await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: {
        baseVersionId: v2.body.id,
        scene: Object.fromEntries(Object.entries(sampleScene(3)).reverse()),
      },
    });
    expect(same.status).toBe(200);
    expect(same.body.id).toBe(v2.body.id);
    const list = await s.api('GET', `/projects/${p.id}/versions`, { token: u.token });
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([v2.body.id, v1.body.id]);
  });

  it('同時兩個儲存只有一個成功（行鎖＋樂觀鎖）', async () => {
    const u = await register(s.api);
    const p = (await s.api('POST', '/projects', { token: u.token, body: { name: 'race' } })).body;
    const rs = await Promise.all(
      [2, 3, 4, 5].map((n) =>
        s.api('POST', `/projects/${p.id}/versions`, {
          token: u.token,
          body: { baseVersionId: null, scene: sampleScene(n) },
        }),
      ),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it('讀回版本含 Scene；還原把目前版本指回舊版；語意錯誤的 Scene → 422', async () => {
    const u = await register(s.api);
    const p = (await s.api('POST', '/projects', { token: u.token, body: { name: 'r' } })).body;
    const v1 = (
      await s.api('POST', `/projects/${p.id}/versions`, {
        token: u.token,
        body: { baseVersionId: null, scene: sampleScene(2) },
      })
    ).body;
    const v2 = (
      await s.api('POST', `/projects/${p.id}/versions`, {
        token: u.token,
        body: { baseVersionId: v1.id, scene: sampleScene(3) },
      })
    ).body;
    const got = await s.api('GET', `/versions/${v1.id}`, { token: u.token });
    expect(got.body.scene.levels[0].walls).toHaveLength(2);
    const rest = await s.api('POST', `/projects/${p.id}/restore/${v1.id}`, { token: u.token });
    expect(rest.body.currentVersionId).toBe(v1.id);
    const bad = sampleScene(2);
    bad.levels[0]!.walls[1]!.id = 'w_0'; // 重複 id：通過 JSON Schema，但語意檢查失敗
    const r = await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: { baseVersionId: v1.id, scene: bad },
    });
    expect(r.status).toBe(422);
    expect(r.body.details.some((i: { code: string }) => i.code === 'DUPLICATE_ID')).toBe(true);
    void v2;
  });

  it('其他租戶讀版本 → 404', async () => {
    const a = await register(s.api, 'a');
    const b = await register(s.api, 'b');
    const p = (await s.api('POST', '/projects', { token: a.token, body: { name: 'x' } })).body;
    const v = (
      await s.api('POST', `/projects/${p.id}/versions`, {
        token: a.token,
        body: { baseVersionId: null, scene: sampleScene(2) },
      })
    ).body;
    expect((await s.api('GET', `/versions/${v.id}`, { token: b.token })).status).toBe(404);
    expect((await s.api('GET', `/projects/${p.id}/versions`, { token: b.token })).status).toBe(404);
  });
});

describe('限流', () => {
  it('登入端點依 IP 限流 → 429 RATE_LIMITED + Retry-After', async () => {
    const t = await createStack({
      rateLimit: { capacity: 1000, refillPerSec: 100, loginCapacity: 3, loginRefillPerSec: 0.01 },
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++)
        codes.push(
          (await t.api('POST', '/auth/login', { body: { email: 'x@test.local', password: 'password-123' } }))
            .status,
        );
      expect(codes).toEqual([401, 401, 401, 429, 429]);
      const r = await t.api('POST', '/auth/login', {
        body: { email: 'x@test.local', password: 'password-123' },
      });
      expect(r.body.code).toBe('RATE_LIMITED');
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await t.close();
    }
  });
});
