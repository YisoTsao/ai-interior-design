import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  compositeOutsideMask,
  encodeId,
  gray,
  maskFromIds,
  maskToRGBA,
  resizeMask,
  rgba,
  structuralEdges,
  type RGBA,
} from '@interiorai/image-ops';
import { createAiRuntime } from '../../src/ai/runtime.js';
import type { MockMode } from '../../src/ai/providers/mock.js';
import { decodePng, encodePng, readPngText } from '../../src/ai/png.js';
import { Storage } from '../../src/infra/storage.js';
import { createStack, register, sampleScene, until, type Stack } from '../support/stack.js';

let s: Stack;
let mode: MockMode = 'ok';
let resetBreaker = () => {};
let processors: Awaited<ReturnType<typeof createAiRuntime>>['processors'];
// 熔斷器是程序層級狀態：「供應商故障」案例會讓它開路 60 秒，各案例之間重設
beforeEach(() => resetBreaker());
beforeAll(async () => {
  s = await createStack({ jobTimeoutMs: 20_000 });
  const ai = await createAiRuntime(
    { db: s.appDb, storage: new Storage(s.config.s3) },
    { AI_PROVIDER: 'mock' },
    {
      mockMode: () => mode,
      backoffMs: 10,
    },
  );
  resetBreaker = () => ai.router.breaker.reset();
  processors = ai.processors;
  await s.startWorker({ render: ai.processors.render, inpaint: ai.processors.inpaint });
});
afterAll(() => s?.close());

/** 合成 G-buffer（與 image-ops 測試相同的三個物件） */
function gbuffer(w = 320, h = 240) {
  const clay = rgba(w, h);
  const ids = rgba(w, h);
  const depth = gray(w, h);
  const boxes = [
    { code: 1, id: 'w_0', x: 0, y: 0, w, h: 60, v: 180, d: 240 },
    { code: 2, id: 'obj_sofa', x: 30, y: 110, w: 120, h: 80, v: 120, d: 90 },
    { code: 3, id: 'obj_table', x: 190, y: 130, w: 90, h: 70, v: 210, d: 150 },
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let [v, code, d] = [140, 0, 250];
      for (const b of boxes)
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) [v, code, d] = [b.v, b.code, b.d];
      clay.data.set([v, v, v, 255], i * 4);
      ids.data.set([...encodeId(code), 255], i * 4);
      depth.data[i] = d;
    }
  const toRGBA = (g: typeof depth) => {
    const out = rgba(w, h);
    g.data.forEach((v, i) => out.data.set([v, v, v, 255], i * 4));
    return out;
  };
  return {
    clay,
    ids,
    idMap: Object.fromEntries(
      boxes.map((b) => [String(b.code), { id: b.id, kind: b.id.startsWith('w_') ? 'wall' : 'object' }]),
    ),
    files: {
      color: encodePng(clay),
      depth: encodePng(toRGBA(depth)),
      edge: encodePng(maskToRGBA(structuralEdges(ids, depth))),
      objectId: encodePng(ids),
    },
  };
}

async function upload(token: string, buf: Buffer) {
  const t = await s.api('POST', '/uploads', {
    token,
    body: { kind: 'gbuffer', filename: 'g.png', mime: 'image/png', sizeBytes: buf.length },
  });
  await fetch(t.body.putUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(buf) });
  const done = await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token });
  expect(done.body.status).toBe('uploaded');
  return t.body.upload.id as string;
}

/** 使用者＋專案＋版本＋已上傳 G-buffer，回傳可直接送出的 RenderRequest */
async function prepare() {
  const u = await register(s.api);
  const p = (await s.api('POST', '/projects', { token: u.token, body: { name: 'render' } })).body;
  const v = (
    await s.api('POST', `/projects/${p.id}/versions`, {
      token: u.token,
      body: { baseVersionId: null, scene: sampleScene(3) },
    })
  ).body;
  const g = gbuffer();
  const ids = {
    color: await upload(u.token, g.files.color),
    depth: await upload(u.token, g.files.depth),
    edge: await upload(u.token, g.files.edge),
    objectId: await upload(u.token, g.files.objectId),
  };
  const body = {
    projectId: p.id,
    versionId: v.id,
    camera: { position: [1, 2, 3], target: [0, 0, 0], fovDeg: 22 },
    gbufferUploadIds: ids,
    idMap: g.idMap,
    settings: {
      styleTemplateId: 'japandi',
      strictness: 'balanced',
      resolution: '1k',
      extra: '暖色木質、午後陽光',
    },
  };
  return { u, body, g };
}

const submit = (token: string, body: unknown, key = `r-${Math.random()}`) =>
  s.api('POST', '/renders', { token, body, headers: { 'idempotency-key': key } });
const finished = (token: string, id: string) =>
  until(
    () => s.api('GET', `/renders/${id}`, { token }),
    (r) => ['succeeded', 'failed', 'canceled'].includes(r.body.state),
    30_000,
  );
const balance = async (token: string) => (await s.api('GET', '/credits', { token })).body.balance as number;
const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());

describe('AI 渲染（mock provider，E2E）', () => {
  it('正常路徑：預扣→渲染→結構驗證通過→結算；輸出含 AI 標示與 provenance', async () => {
    mode = 'ok';
    const { u, body } = await prepare();
    const job = await submit(u.token, body);
    expect(job.status).toBe(202);
    expect(job.body.costEstimateCredits).toBe(1);
    expect(await balance(u.token)).toBe(19);
    const r = await finished(u.token, job.body.id);
    expect(r.body).toMatchObject({
      state: 'succeeded',
      kind: 'render',
      accepted: false,
      previewUrl: null,
      width: 1024,
      height: 768,
    });
    expect(r.body.validation.passed).toBe(true);
    expect(r.body.validation.calibrated).toBe(false);
    const prov = r.body.provenance;
    expect(prov).toMatchObject({
      provider: 'mock',
      route: 'A',
      promptTemplateId: 'render.balanced',
      promptTemplateVersion: '1.1.0',
      seedSupported: true,
    });
    expect(prov.sceneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.gbufferHash).toMatch(/^[0-9a-f]{64}$/);
    const img = await download(r.body.outputUrl);
    expect(readPngText(img)['AI-Generated']).toBe('true');
    expect(await balance(u.token)).toBe(19); // settle：實際＝預扣
    const job2 = (await s.api('GET', `/jobs/${job.body.id}`, { token: u.token })).body;
    expect(job2.retryCount).toBe(0);
  });

  it('break_structure：驗證失敗→重試（提高嚴格度）→降級到 strict 路線→仍失敗→退款、JOB_FAILED、只給浮水印預覽', async () => {
    mode = 'break_structure';
    const { u, body } = await prepare();
    const job = await submit(u.token, body);
    const r = await finished(u.token, job.body.id);
    expect(r.body.state).toBe('failed');
    expect(r.body.errorCode).toBe('JOB_FAILED');
    expect(r.body.outputUrl).toBeNull();
    expect(r.body.previewUrl).toBeTruthy();
    const val = r.body.provenance.attempts.filter((a: { layer: string }) => a.layer === 'validation');
    expect(val.map((a: { route: string }) => a.route)).toEqual(['A', 'A', 'B']);
    expect(val.every((a: { ok: boolean; score: number }) => !a.ok && a.score < 0.65)).toBe(true);
    // 門檻固定為使用者選擇的 balanced（降級不加嚴，ADR-012）
    expect(r.body.provenance.validation.threshold).toBe(0.8);
    expect((await s.api('GET', `/jobs/${job.body.id}`, { token: u.token })).body.retryCount).toBe(2);
    expect(await balance(u.token)).toBe(20); // 已退款
    const preview = decodePng(await download(r.body.previewUrl));
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(1024);

    // 仍要使用：以 adjust 扣回成本（冪等）後才有無浮水印下載
    const acc = await s.api('POST', `/renders/${job.body.id}/accept`, {
      token: u.token,
      headers: { 'idempotency-key': `acc-${job.body.id}` },
    });
    expect(acc.status).toBe(200);
    expect(acc.body.accepted).toBe(true);
    expect(acc.body.outputUrl).toBeTruthy();
    await s.api('POST', `/renders/${job.body.id}/accept`, {
      token: u.token,
      headers: { 'idempotency-key': `acc2-${job.body.id}` },
    });
    expect(await balance(u.token)).toBe(19);
    const rows = await s.owner.orm.execute<{ reason: string }>(
      sql`SELECT reason FROM credit_ledger WHERE job_id = ${job.body.id} ORDER BY id`,
    );
    expect(rows.rows.map((x) => x.reason)).toEqual(['reserve', 'refund', 'adjust']);
  });

  it('strict：沒有備援路線，門檻 0.90；break_structure 三次都在同一路線', async () => {
    mode = 'break_structure';
    const { u, body } = await prepare();
    const job = await submit(u.token, { ...body, settings: { ...body.settings, strictness: 'strict' } });
    const r = await finished(u.token, job.body.id);
    const val = r.body.provenance.attempts.filter((a: { layer: string }) => a.layer === 'validation');
    expect(val.map((a: { route: string }) => a.route)).toEqual(['B', 'B', 'B']);
    expect(r.body.provenance.validation.threshold).toBe(0.9);
  });

  it('局部重繪：遮罩由 objectId 產生；遮罩外像素逐位元不變（B6.2-3）', async () => {
    mode = 'ok';
    const { u, body, g } = await prepare();
    const base = await finished(u.token, (await submit(u.token, body)).body.id);
    const ip = await s.api('POST', `/renders/${base.body.id}/inpaint`, {
      token: u.token,
      body: { objectIds: ['obj_sofa'], instruction: 'replace with a green velvet sofa' },
      headers: { 'idempotency-key': `ip-${base.body.id}` },
    });
    expect(ip.status).toBe(202);
    const r = await finished(u.token, ip.body.id);
    expect(r.body).toMatchObject({ state: 'succeeded', kind: 'inpaint', baseRenderId: base.body.id });
    const before = decodePng(await download(base.body.outputUrl));
    const after = decodePng(await download(r.body.outputUrl));
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    const mask = resizeMask(maskFromIds(g.ids, [2], 3), before.width, before.height);
    let outside = 0;
    let changedInside = 0;
    for (let i = 0; i < mask.data.length; i++) {
      const same = [0, 1, 2, 3].every((c) => before.data[i * 4 + c] === after.data[i * 4 + c]);
      if (!mask.data[i]) {
        outside++;
        if (!same) throw new Error(`遮罩外像素 ${i} 被改動`);
      } else if (!same) changedInside++;
    }
    expect(outside).toBeGreaterThan(0);
    expect(changedInside).toBeGreaterThan(0);
    expect(r.body.provenance.maskedPixels).toBeGreaterThan(0);
    // 交叉驗證：與本地合成結果一致
    const expected: RGBA = compositeOutsideMask(before, after, mask);
    expect(Buffer.from(expected.data).equals(Buffer.from(after.data))).toBe(true);
  });

  it('供應商故障：呼叫層重試（不計入 retry_count）→ 備援也故障 → PROVIDER_UNAVAILABLE＋退款', async () => {
    mode = 'fail';
    const { u, body } = await prepare();
    const job = await submit(u.token, body);
    const r = await finished(u.token, job.body.id);
    expect(r.body.errorCode).toBe('PROVIDER_UNAVAILABLE');
    const provider = r.body.provenance.attempts.filter((a: { layer: string }) => a.layer === 'provider');
    // 每條路線：1 次＋ 2 次退避重試（provider_call_max）
    expect(provider.filter((a: { route: string }) => a.route === 'A')).toHaveLength(3);
    expect(provider.filter((a: { route: string }) => a.route === 'B')).toHaveLength(3);
    expect((await s.api('GET', `/jobs/${job.body.id}`, { token: u.token })).body.retryCount).toBe(0);
    expect(await balance(u.token)).toBe(20);
  });

  it('取消執行中的渲染 → canceled＋退款', async () => {
    mode = 'slow';
    const { u, body } = await prepare();
    const job = await submit(u.token, body);
    await until(
      () => s.api('GET', `/renders/${job.body.id}`, { token: u.token }),
      (r) => r.body.state === 'running',
    );
    const c = await s.api('POST', `/renders/${job.body.id}/cancel`, { token: u.token });
    expect(c.body.state).toBe('canceled');
    expect(await balance(u.token)).toBe(20);
  });

  it('Idempotency-Key：同 key 重送只建立一個任務、只扣一次；同 key 不同內容 → 422', async () => {
    mode = 'ok';
    const { u, body } = await prepare();
    const key = `same-${Date.now()}`;
    const [a, b] = await Promise.all([submit(u.token, body, key), submit(u.token, body, key)]);
    expect(a.body.id).toBe(b.body.id);
    expect(await balance(u.token)).toBe(19);
    const other = await submit(
      u.token,
      { ...body, settings: { ...body.settings, styleTemplateId: 'luxury' } },
      key,
    );
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await finished(u.token, a.body.id);
  });

  it('4K 需確認、審核阻擋、點數不足、別人的 G-buffer', async () => {
    const { u, body } = await prepare();
    const k4 = await submit(u.token, { ...body, settings: { ...body.settings, resolution: '4k' } });
    expect([k4.status, k4.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const mod = await submit(u.token, { ...body, settings: { ...body.settings, extra: '加一張裸體畫' } });
    expect(mod.body.code).toBe('MODERATION_BLOCKED');
    // 餘額 20，4K（8 點）確認後可送出兩次，第三次不足
    const big = { ...body, settings: { ...body.settings, resolution: '4k', confirmHighRes: true } };
    mode = 'slow';
    expect((await submit(u.token, big)).status).toBe(202);
    expect((await submit(u.token, big)).status).toBe(202);
    const poor = await submit(u.token, big);
    expect([poor.status, poor.body.code]).toEqual([402, 'INSUFFICIENT_CREDITS']);
    const other = await register(s.api);
    const theirs = await submit(other.token, body);
    expect(theirs.status).toBe(404); // 專案版本不屬於他
  });
});

describe('成本硬上限（ADR-012 §3）', () => {
  it('累計成本超過 max_usd_per_job → 中止並退款', async () => {
    const t = await createStack({ jobTimeoutMs: 20_000 });
    try {
      const ai = await createAiRuntime(
        { db: t.appDb, storage: new Storage(t.config.s3) },
        { AI_PROVIDER: 'mock' },
        {
          mockMode: () => 'break_structure',
          backoffMs: 10,
          mockCostUsd: 0.6, // 上限 1.00 → 第二次呼叫就超過
        },
      );
      await t.startWorker({ render: ai.processors.render });
      const saved = s;
      s = t;
      try {
        const { u, body } = await prepare();
        const job = await submit(u.token, body);
        const r = await finished(u.token, job.body.id);
        expect(r.body.state).toBe('failed');
        expect(r.body.errorMessage).toMatch(/成本上限/);
        expect(await balance(u.token)).toBe(20);
      } finally {
        s = saved;
      }
    } finally {
      await t.close();
    }
  });
});

describe('重新投遞（ADR-012 §2b）', () => {
  it('已用掉 2 次驗證重試的任務被重跑時，只再驗證 1 次、不再增加 retry_count', async () => {
    mode = 'break_structure';
    const { u, body } = await prepare();
    const job = await submit(u.token, body);
    await finished(u.token, job.body.id);
    const row = await s.jobs.get(u.orgId, job.body.id);
    const calls = { retry: 0, validating: 0 };
    const err = await processors
      .render({
        job: { ...row, retryCount: 2 },
        signal: new AbortController().signal,
        progress: async () => {},
        validating: async () => void calls.validating++,
        retryValidation: async () => void calls.retry++,
      })
      .catch((e: Error) => e);
    expect((err as { code?: string }).code).toBe('JOB_FAILED');
    expect(calls).toEqual({ retry: 0, validating: 1 });
    const val = (
      err as unknown as { provenance: { attempts: { layer: string; route: string }[] } }
    ).provenance.attempts.filter((a) => a.layer === 'validation');
    expect(val.map((a) => a.route)).toEqual(['B']); // 第 3 次（v=2）走降級路線
  });
});
