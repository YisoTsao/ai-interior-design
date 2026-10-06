import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenApiContract, phaseNum } from '../../src/common/openapi.js';
import { signPayload } from '../../src/modules/billing/billing.controller.js';
import { encodePng } from '../../src/ai/png.js';
import { rgba } from '@interiorai/image-ops';
import { createStack, sampleScene, type Stack, putObject } from '../support/stack.js';

/** 目前交付到的 Phase：契約中 x-phase ≤ 此值的 operation 必須全部實作 */
const CURRENT_PHASE = process.env.CONTRACT_PHASE ?? 'P5';

let s: Stack;
let contract: OpenApiContract;
beforeAll(async () => {
  s = await createStack(); // strictResponses=true：任何回應不符契約都會變成 500
  contract = await OpenApiContract.load(s.config.openapiPath);
});
afterAll(() => s?.close());

/** 從 Express router 取出實際註冊的路由 */
function routes(stack: Stack): string[] {
  const inst = stack.app.getHttpAdapter().getInstance() as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return inst.router.stack
    .filter((l) => l.route)
    .flatMap((l) =>
      Object.keys(l.route!.methods)
        .filter((m) => m !== '_all')
        .map((m) => `${m.toUpperCase()} ${l.route!.path.replace(/^\/v1/, '').replace(/:(\w+)/g, '{$1}')}`),
    );
}

describe(`API 契約（${CURRENT_PHASE}）`, () => {
  it('每個實作的路由都在契約內，且階段不晚於目前 Phase', () => {
    for (const r of routes(s)) {
      const [m, p] = r.split(' ');
      const op = contract.operations.find((o) => o.method === m && o.path === p);
      expect(op, `契約外的路由：${r}`).toBeDefined();
      expect(phaseNum(op!.phase), r).toBeLessThanOrEqual(phaseNum(CURRENT_PHASE));
    }
  });

  it(`契約中 x-phase ≤ ${CURRENT_PHASE} 的 operation 全部已實作`, () => {
    const have = new Set(routes(s));
    const missing = contract
      .dueBy(CURRENT_PHASE)
      .map((o) => `${o.method} ${o.path}`)
      .filter((k) => !have.has(k));
    expect(missing).toEqual([]);
  });

  it('逐一呼叫每個已實作 operation，回應都符合契約（嚴格回應驗證）', async () => {
    const hit = new Set<string>();
    const call = async (
      method: string,
      path: string,
      template: string,
      o: Parameters<Stack['api']>[2] = {},
    ) => {
      const r = await s.api(method, path, o);
      expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBeLessThan(500);
      hit.add(`${method} ${template}`);
      return r;
    };
    expect((await call('GET', '/healthz', '/healthz')).status).toBe(200);
    const email = `contract${Date.now()}@test.local`;
    const reg = await call('POST', '/auth/register', '/auth/register', {
      body: { email, password: 'password-123' },
    });
    const token = reg.body.accessToken as string;
    await call('POST', '/auth/login', '/auth/login', { body: { email, password: 'password-123' } });
    const ref = await call('POST', '/auth/refresh', '/auth/refresh', {
      body: { refreshToken: reg.body.refreshToken },
    });
    const me = await call('GET', '/me', '/me', { token });
    const t = { token };
    const p = await call('POST', '/projects', '/projects', { ...t, body: { name: 'c' } });
    await call('GET', '/projects', '/projects', t);
    await call('GET', `/projects/${p.body.id}`, '/projects/{id}', t);
    await call('PATCH', `/projects/${p.body.id}`, '/projects/{id}', { ...t, body: { name: 'c2' } });
    const v = await call('POST', `/projects/${p.body.id}/versions`, '/projects/{id}/versions', {
      ...t,
      body: { baseVersionId: null, scene: sampleScene(2) },
    });
    const conflict = await call('POST', `/projects/${p.body.id}/versions`, '/projects/{id}/versions', {
      ...t,
      body: { baseVersionId: null, scene: sampleScene(3) },
    });
    expect(conflict.status).toBe(409);
    await call('GET', `/projects/${p.body.id}/versions`, '/projects/{id}/versions', t);
    await call('GET', `/versions/${v.body.id}`, '/versions/{id}', t);
    await call(
      'POST',
      `/projects/${p.body.id}/restore/${v.body.id}`,
      '/projects/{id}/restore/{versionId}',
      t,
    );
    const up = await call('POST', '/uploads', '/uploads', {
      ...t,
      body: { kind: 'photo', filename: 'a.png', mime: 'image/png', sizeBytes: 10 },
    });
    await call('POST', `/uploads/${up.body.upload.id}/complete`, '/uploads/{id}/complete', t);
    const assets = await call('GET', '/assets', '/assets', t);
    await call('GET', `/assets/${assets.body.items[0].id}`, '/assets/{id}', t);
    await call('POST', '/assets', '/assets', {
      ...t,
      body: {
        slug: 'contract_asset',
        nameZh: 'x',
        category: 'living',
        dimsMm: { w: 1, d: 1, h: 1 },
        anchor: 'floor',
        uploadId: up.body.upload.id,
        license: { type: 'x', source: 'y' },
      },
    });
    await call('GET', '/materials', '/materials', t);
    await call('GET', '/credits', '/credits', t);
    await call('GET', '/credits/ledger', '/credits/ledger', t);
    await call('POST', '/credits/checkout', '/credits/checkout', {
      ...t,
      body: { packageId: 'credits_50' },
      headers: { 'idempotency-key': `contract-${Date.now()}` },
    });
    const raw = JSON.stringify({
      id: `evt_c_${Date.now()}`,
      type: 'payment.succeeded',
      orgId: me.body.activeOrgId,
      credits: 5,
    });
    await call('POST', '/webhooks/payments', '/webhooks/payments', {
      raw,
      headers: { 'x-signature': signPayload(raw, s.config.webhookSecret) },
    });
    const job = await s.jobs.create(
      { orgId: me.body.activeOrgId, userId: me.body.id },
      { type: 'thumbnail', input: {}, costEstimate: 1 },
    );
    await call('GET', `/jobs/${job.id}`, '/jobs/{id}', t);
    await call('POST', `/jobs/${job.id}/cancel`, '/jobs/{id}/cancel', t);
    await call('GET', `/jobs/${job.id}/events`, '/jobs/{id}/events', t);
    // P4：渲染（沒有 worker → 任務停在 queued；用來驗證回應格式）
    await call('GET', '/pricing', '/pricing');
    const png = encodePng(rgba(64, 48, new Uint8Array(64 * 48 * 4).fill(128)));
    const gb: Record<string, string> = {};
    for (const k of ['color', 'depth', 'edge', 'objectId']) {
      const tk = await s.api('POST', '/uploads', {
        ...t,
        body: { kind: 'gbuffer', filename: `${k}.png`, mime: 'image/png', sizeBytes: png.length },
      });
      await putObject(tk.body.putUrl, tk.body.headers, png);
      await s.api('POST', `/uploads/${tk.body.upload.id}/complete`, t);
      gb[k] = tk.body.upload.id;
    }
    const rj = await call('POST', '/renders', '/renders', {
      ...t,
      headers: { 'idempotency-key': `contract-render-${Date.now()}` },
      body: {
        projectId: p.body.id,
        versionId: v.body.id,
        camera: { fovDeg: 22 },
        gbufferUploadIds: gb,
        idMap: { '1': { id: 'w_0', kind: 'wall' } },
        settings: { styleTemplateId: 'modern', strictness: 'balanced', resolution: '1k' },
      },
    });
    expect(rj.status).toBe(202);
    await call('GET', `/renders/${rj.body.id}`, '/renders/{id}', t);
    const ip = await call('POST', `/renders/${rj.body.id}/inpaint`, '/renders/{id}/inpaint', {
      ...t,
      headers: { 'idempotency-key': `contract-ip-${Date.now()}` },
      body: { objectIds: ['w_0'], instruction: 'x' },
    });
    expect(ip.status).toBe(409); // 基底尚未完成
    const acc = await call('POST', `/renders/${rj.body.id}/accept`, '/renders/{id}/accept', {
      ...t,
      headers: { 'idempotency-key': `contract-acc-${Date.now()}` },
    });
    expect(acc.status).toBe(409);
    await call('POST', `/renders/${rj.body.id}/cancel`, '/renders/{id}/cancel', t);
    // P5：平面圖匯入（沒有 worker → 任務停在 queued）
    const dxf = Buffer.from('  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n  0\nEOF\n');
    const pu = await s.api('POST', '/uploads', {
      ...t,
      body: { kind: 'plan', filename: 'a.dxf', mime: 'application/dxf', sizeBytes: dxf.length },
    });
    await putObject(pu.body.putUrl, pu.body.headers, dxf);
    await s.api('POST', `/uploads/${pu.body.upload.id}/complete`, t);
    const pi = await call('POST', '/plan-imports', '/plan-imports', {
      ...t,
      headers: { 'idempotency-key': `contract-pi-${Date.now()}` },
      body: { uploadId: pu.body.upload.id },
    });
    expect(pi.status).toBe(202);
    const pg = await call('GET', `/plan-imports/${pi.body.id}`, '/plan-imports/{id}', t);
    expect(pg.body).toMatchObject({ state: 'queued', result: null });
    await call('DELETE', `/projects/${p.body.id}`, '/projects/{id}', t);
    await call('POST', '/auth/logout', '/auth/logout', { body: { refreshToken: ref.body.refreshToken } });

    const due = contract.dueBy(CURRENT_PHASE).map((o) => `${o.method} ${o.path}`);
    expect(
      due.filter((k) => !hit.has(k)),
      '契約測試沒有覆蓋到的 operation',
    ).toEqual([]);
  });

  it('錯誤回應一律為 { code, message, requestId }', async () => {
    const r = await s.api('GET', '/nope');
    expect(r.status).toBe(404);
    expect(Object.keys(r.body).sort()).toEqual(['code', 'message', 'requestId']);
    const bad = await s.api('POST', '/auth/login', { raw: '{not json' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });
});
