import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStack, register, type Stack } from '../support/stack.js';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
afterAll(() => s?.close());

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 7),
]);

async function upload(
  token: string,
  kind: string,
  filename: string,
  mime: string,
  body: Buffer,
  declared = body.length,
) {
  const t = await s.api('POST', '/uploads', { token, body: { kind, filename, mime, sizeBytes: declared } });
  if (t.status !== 201) return { ticket: t, put: null, done: null };
  const put = await fetch(t.body.putUrl, { method: 'PUT', headers: t.body.headers, body: body });
  const done = await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token });
  return { ticket: t, put, done };
}

describe('上傳（預簽名 URL）', () => {
  it('PNG：預簽名 PUT → complete → uploaded', async () => {
    const u = await register(s.api);
    const r = await upload(u.token, 'gbuffer', 'depth.png', 'image/png', PNG);
    expect(r.put!.status).toBe(200);
    expect(r.done!.status).toBe(200);
    expect(r.done!.body.status).toBe('uploaded');
    // 預簽名 URL 限定 content-type：換型別上傳被 S3 拒絕
    const t = await s.api('POST', '/uploads', {
      token: u.token,
      body: { kind: 'gbuffer', filename: 'a.png', mime: 'image/png', sizeBytes: PNG.length },
    });
    const wrong = await fetch(t.body.putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: PNG,
    });
    expect(wrong.status).toBe(403);
  });

  it('內容與宣告的 mime 不符 → 422 UPLOAD_REJECTED 並標 rejected', async () => {
    const u = await register(s.api);
    const fake = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(128, ' '));
    const r = await upload(u.token, 'photo', 'x.png', 'image/png', fake);
    expect(r.done!.status).toBe(422);
    expect(r.done!.body.code).toBe('UPLOAD_REJECTED');
    expect(r.done!.body.details.upload.status).toBe('rejected');
  });

  it('DWG、不在白名單的型別、超過上限 → 建立時就 422', async () => {
    const u = await register(s.api);
    for (const b of [
      { kind: 'plan', filename: 'a.dwg', mime: 'application/acad', sizeBytes: 100 },
      { kind: 'photo', filename: 'a.svg', mime: 'image/svg+xml', sizeBytes: 100 },
      { kind: 'photo', filename: 'a.png', mime: 'image/png', sizeBytes: 999 * 1024 * 1024 },
    ]) {
      const r = await s.api('POST', '/uploads', { token: u.token, body: b });
      expect(r.status, b.filename).toBe(422);
      expect(r.body.code).toBe('UPLOAD_REJECTED');
    }
  });

  it('尚未上傳就 complete → 422；別的組織不能 complete', async () => {
    const a = await register(s.api, 'a');
    const b = await register(s.api, 'b');
    const t = await s.api('POST', '/uploads', {
      token: a.token,
      body: { kind: 'photo', filename: 'a.png', mime: 'image/png', sizeBytes: 10 },
    });
    expect((await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token: a.token })).status).toBe(
      422,
    );
    expect((await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token: b.token })).status).toBe(
      404,
    );
  });
});

describe('資產庫', () => {
  it('搜尋只回 published、支援分類與分頁；draft 資產看不到', async () => {
    const u = await register(s.api);
    const all = await s.api('GET', '/assets?limit=100', { token: u.token });
    expect(all.body.items.length).toBe(47);
    expect(all.body.items.every((a: { status: string }) => a.status === 'published')).toBe(true);
    expect(all.body.items.some((a: { slug: string }) => a.slug === 'sofa_vendor_x')).toBe(false);
    const decor = await s.api('GET', '/assets?category=decor', { token: u.token });
    expect(decor.body.items.every((a: { category: string }) => a.category === 'decor')).toBe(true);
    const q = await s.api('GET', `/assets?q=${encodeURIComponent('沙發')}`, { token: u.token });
    expect(q.body.items.length).toBeGreaterThan(0);
    const p1 = await s.api('GET', '/assets?limit=10', { token: u.token });
    const p2 = await s.api('GET', `/assets?limit=10&cursor=${p1.body.nextCursor}`, { token: u.token });
    expect(p2.body.items[0].slug > p1.body.items[9].slug).toBe(true);
    const one = await s.api('GET', `/assets/${p1.body.items[0].id}`, { token: u.token });
    expect(one.body.slug).toBe(p1.body.items[0].slug);
    expect((await s.api('GET', '/materials', { token: u.token })).body.items.length).toBeGreaterThan(5);
  });

  it('使用者上傳資產 → review（上架前不出現在搜尋）；重複 slug → 409', async () => {
    const u = await register(s.api);
    const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60)]);
    const up = await upload(u.token, 'asset', 'chair.glb', 'model/gltf-binary', glb);
    const body = {
      slug: `user_chair_${Date.now()}`,
      nameZh: '使用者椅子',
      category: 'living',
      dimsMm: { w: 500, d: 500, h: 800 },
      anchor: 'floor',
      uploadId: up.ticket.body.upload.id,
      license: { type: 'CC-BY-4.0', source: 'user' },
    };
    const r = await s.api('POST', '/assets', { token: u.token, body });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('review');
    expect((await s.api('GET', `/assets/${r.body.id}`, { token: u.token })).status).toBe(200);
    const other = await register(s.api);
    expect((await s.api('GET', `/assets/${r.body.id}`, { token: other.token })).status).toBe(404);
    expect((await s.api('POST', '/assets', { token: u.token, body })).status).toBe(409);
  });
});
