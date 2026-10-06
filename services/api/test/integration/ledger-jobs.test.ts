import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPayload } from '../../src/modules/billing/billing.controller.js';
import { reconcile } from '../../src/modules/billing/reconcile.js';
import { reapZombies } from '../../src/worker/maintenance.js';
import { JobFailure, type Processor } from '../../src/worker/runtime.js';
import { createStack, register, until, type Stack } from '../support/stack.js';

let s: Stack;
beforeAll(async () => {
  s = await createStack({ jobTimeoutMs: 1500 });
});
afterAll(() => s?.close());

const ledgerOf = async (orgId: string) =>
  (
    await s.owner.orm.execute<{
      reason: string;
      delta: number;
      job_id: string | null;
      balance_after: number;
    }>(
      sql`SELECT reason, delta, job_id, balance_after FROM credit_ledger WHERE org_id = ${orgId} ORDER BY id`,
    )
  ).rows;
const balanceOf = async (token: string) => (await s.api('GET', '/credits', { token })).body.balance as number;
const auth = (u: { orgId: string; userId: string }) => ({ orgId: u.orgId, userId: u.userId });

describe('點數帳本（ADR-014）', () => {
  it('併發預扣：餘額 20、30 個各扣 1 的任務同時送出 → 恰好 20 個成功，餘額 0，不為負', async () => {
    const u = await register(s.api);
    const rs = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 1 }),
      ),
    );
    const ok = rs.filter((r) => r.status === 'fulfilled').length;
    const insufficient = rs.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'INSUFFICIENT_CREDITS',
    ).length;
    expect([ok, insufficient]).toEqual([20, 10]);
    expect(await balanceOf(u.token)).toBe(0);
    const rows = await ledgerOf(u.orgId);
    expect(rows.every((r) => r.balance_after >= 0)).toBe(true);
    expect(rows.reduce((a, r) => a + r.delta, 0)).toBe(0);
    // 失敗的建立不留下任務（交易回滾）
    const jobs = await s.owner.orm.execute(
      sql`SELECT count(*)::int AS n FROM jobs WHERE org_id = ${u.orgId}`,
    );
    expect((jobs.rows[0] as { n: number }).n).toBe(20);
  });

  it('同一 Job 的 reserve/settle/refund 冪等；重複 settle 被擋；settle 不補扣；已結算不能退款', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 5 });
    await s.appDb.tx(u.orgId, async (tx) => {
      const again = await s.ledger.reserve(tx, u.orgId, job.id, 5);
      expect(again.replayed).toBe(true);
    });
    const settle = () => s.appDb.tx(u.orgId, (tx) => s.ledger.settle(tx, u.orgId, job.id, 99));
    const r1 = await settle();
    expect(r1!.entry.delta).toBe(0); // 實際 99 > 預扣 5 → 只收 5，不補扣
    expect((await settle())!.replayed).toBe(true);
    await expect(s.appDb.tx(u.orgId, (tx) => s.ledger.refund(tx, u.orgId, job.id))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const rows = (await ledgerOf(u.orgId)).filter((r) => r.job_id === job.id);
    expect(rows.map((r) => r.reason)).toEqual(['reserve', 'settle']);
    expect(await balanceOf(u.token)).toBe(15);
  });

  it('settle 退回差額（實際 < 預扣）', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 8 });
    await s.appDb.tx(u.orgId, (tx) => s.ledger.settle(tx, u.orgId, job.id, 3));
    expect(await balanceOf(u.token)).toBe(20 - 3);
  });

  it('僵屍預扣回收：逾時未終態 → failed＋退款；重跑回收不會重複退款', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 4 });
    expect(await balanceOf(u.token)).toBe(16);
    await s.owner.orm.execute(
      sql`UPDATE jobs SET created_at = now() - interval '1 hour' WHERE id = ${job.id}`,
    );
    expect(await reapZombies(s.system, s.jobs, 1500)).toBeGreaterThanOrEqual(1);
    await reapZombies(s.system, s.jobs, 1500);
    const rows = (await ledgerOf(u.orgId)).filter((r) => r.job_id === job.id);
    expect(rows.map((r) => r.reason)).toEqual(['reserve', 'refund']);
    expect(await balanceOf(u.token)).toBe(20);
    expect((await s.api('GET', `/jobs/${job.id}`, { token: u.token })).body.state).toBe('failed');
  });

  it('對帳：快取被竄改 → 凍結該 org 的新預扣（CREDITS_FROZEN）；一致的 org 不受影響', async () => {
    const bad = await register(s.api, 'bad');
    const good = await register(s.api, 'good');
    await s.owner.orm.execute(sql`UPDATE credit_balances SET balance = 999 WHERE org_id = ${bad.orgId}`);
    const issues = await reconcile(s.system);
    expect(issues.map((i) => i.orgId)).toContain(bad.orgId);
    expect(issues.map((i) => i.orgId)).not.toContain(good.orgId);
    expect((await s.api('GET', '/credits', { token: bad.token })).body.frozen).toBe(true);
    await expect(
      s.jobs.create(auth(bad), { type: 'thumbnail', input: {}, costEstimate: 1 }),
    ).rejects.toMatchObject({ code: 'CREDITS_FROZEN' });
    await expect(
      s.jobs.create(auth(good), { type: 'thumbnail', input: {}, costEstimate: 1 }),
    ).resolves.toBeTruthy();
    // 對帳可重複執行
    expect((await reconcile(s.system)).map((i) => i.orgId)).toContain(bad.orgId);
  });

  it('金流 webhook：驗簽、同一事件只入帳一次、簽章錯誤 → 401', async () => {
    const u = await register(s.api);
    const evt = { id: `evt_${Date.now()}`, type: 'payment.succeeded', orgId: u.orgId, credits: 50 };
    const raw = JSON.stringify(evt);
    const sig = signPayload(raw, s.config.webhookSecret);
    for (let i = 0; i < 3; i++) {
      const r = await s.api('POST', '/webhooks/payments', { raw, headers: { 'x-signature': sig } });
      expect(r.status).toBe(200);
    }
    expect(await balanceOf(u.token)).toBe(70);
    const forged = await s.api('POST', '/webhooks/payments', {
      raw: JSON.stringify({ ...evt, id: 'evt_forged', credits: 100000 }),
      headers: { 'x-signature': sig },
    });
    expect(forged.status).toBe(401);
    expect(await balanceOf(u.token)).toBe(70);
  });

  it('帳本 API 分頁（新到舊）', async () => {
    const u = await register(s.api);
    for (let i = 0; i < 3; i++)
      await s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 1 });
    const p1 = await s.api('GET', '/credits/ledger?limit=2', { token: u.token });
    const p2 = await s.api('GET', `/credits/ledger?limit=2&cursor=${p1.body.nextCursor}`, { token: u.token });
    expect([...p1.body.items, ...p2.body.items].map((e: { reason: string }) => e.reason)).toEqual([
      'reserve',
      'reserve',
      'reserve',
      'grant',
    ]);
  });
});

describe('HTTP Idempotency-Key', () => {
  it('同 key 同內容 → 回放同一回應；同 key 不同內容 → 422；缺 key → 422', async () => {
    const u = await register(s.api);
    const call = (key: string | undefined, packageId: string) =>
      s.api('POST', '/credits/checkout', {
        token: u.token,
        body: { packageId },
        headers: key ? { 'idempotency-key': key } : {},
      });
    const key = `k-${Date.now()}`;
    const [a, b] = await Promise.all([call(key, 'credits_50'), call(key, 'credits_50')]);
    expect(a.status).toBe(200);
    expect(b.body.checkoutId).toBe(a.body.checkoutId);
    const c = await call(key, 'credits_50');
    expect(c.body.checkoutId).toBe(a.body.checkoutId);
    expect(c.headers.get('idempotent-replayed')).toBe('true');
    const d = await call(key, 'credits_200');
    expect(d.status).toBe(422);
    expect(d.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await call(undefined, 'credits_50')).status).toBe(422);
  });

  it('24 小時後同 key 視為新請求', async () => {
    const u = await register(s.api);
    const key = `old-${Date.now()}`;
    const first = await s.api('POST', '/credits/checkout', {
      token: u.token,
      body: { packageId: 'credits_50' },
      headers: { 'idempotency-key': key },
    });
    await s.owner.orm.execute(
      sql`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = ${key}`,
    );
    const later = await s.api('POST', '/credits/checkout', {
      token: u.token,
      body: { packageId: 'credits_50' },
      headers: { 'idempotency-key': key },
    });
    expect(later.body.checkoutId).not.toBe(first.body.checkoutId);
  });
});

/** 讀 SSE 直到串流結束，回傳所有 job 事件的狀態 */
async function sse(base: string, token: string, jobId: string) {
  const r = await fetch(`${base}/jobs/${jobId}/events`, { headers: { authorization: `Bearer ${token}` } });
  expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
  const text = await r.text();
  return text
    .split('\n\n')
    .map((b) => /^data: (.*)$/m.exec(b)?.[1])
    .filter(Boolean)
    .map((d) => JSON.parse(d!) as { state: string; progress: number });
}

describe('Jobs（BullMQ worker）', () => {
  let stop: () => Promise<void>;
  let attempts = 0;
  beforeAll(async () => {
    const wait = (ms: number, signal: AbortSignal) =>
      new Promise<void>((res, rej) => {
        const t = setTimeout(res, ms);
        signal.addEventListener('abort', () => (clearTimeout(t), rej(signal.reason)));
      });
    const processors: Record<string, Processor> = {
      // 正常：回報進度後成功，實際成本 2
      thumbnail: async ({ progress, signal }) => {
        await wait(150, signal);
        await progress(50);
        await wait(150, signal);
        return { output: { ok: true }, costActualCredits: 2 };
      },
      // 業務失敗：不重試，直接 failed＋退款
      moderation: async () => {
        throw new JobFailure('MODERATION_BLOCKED', '內容不允許');
      },
      // 基礎設施失敗：BullMQ 重試 3 次後進死信
      export: async () => {
        attempts++;
        throw new Error('boom');
      },
      // 長任務：等取消或逾時
      plan_import: async ({ signal }) => {
        await wait(60_000, signal);
        return { output: {}, costActualCredits: 1 };
      },
    };
    stop = await s.startWorker(processors);
  });
  afterAll(() => stop?.());

  it('成功：SSE 依序收到 queued/running → 進度 → succeeded；結算退回差額', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'thumbnail', input: {}, costEstimate: 5 });
    const events = await sse(s.base, u.token, job.id);
    expect(events.at(-1)).toMatchObject({ state: 'succeeded', progress: 100 });
    expect(events.some((e) => e.state === 'running' && e.progress === 50)).toBe(true);
    const got = (await s.api('GET', `/jobs/${job.id}`, { token: u.token })).body;
    expect(got).toMatchObject({ state: 'succeeded', costEstimateCredits: 5, costActualCredits: 2 });
    expect(await balanceOf(u.token)).toBe(18);
  });

  it('業務失敗 → failed＋全額退款；不重試', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'moderation', input: {}, costEstimate: 3 });
    const j = await until(
      () => s.jobs.get(u.orgId, job.id),
      (x) => x.state === 'failed',
    );
    expect(j.errorCode).toBe('MODERATION_BLOCKED');
    expect(await balanceOf(u.token)).toBe(20);
  });

  it('未預期例外 → 重試 3 次 → 死信＋failed＋退款（只退一次）', async () => {
    const u = await register(s.api);
    attempts = 0;
    const job = await s.jobs.create(auth(u), { type: 'export', input: {}, costEstimate: 2 });
    const j = await until(
      () => s.jobs.get(u.orgId, job.id),
      (x) => x.state === 'failed',
      20_000,
    );
    expect(j.errorCode).toBe('JOB_FAILED');
    expect(attempts).toBe(3);
    const rows = (await ledgerOf(u.orgId)).filter((r) => r.job_id === job.id);
    expect(rows.map((r) => r.reason)).toEqual(['reserve', 'refund']);
  });

  it('執行中取消 → canceled＋退款；worker 立即中止；已終態再取消 → 409', async () => {
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'plan_import', input: {}, costEstimate: 4 });
    await until(
      () => s.jobs.get(u.orgId, job.id),
      (x) => x.state === 'running',
    );
    const c = await s.api('POST', `/jobs/${job.id}/cancel`, { token: u.token });
    expect(c.status).toBe(200);
    expect(c.body.state).toBe('canceled');
    expect(await balanceOf(u.token)).toBe(20);
    expect((await s.api('POST', `/jobs/${job.id}/cancel`, { token: u.token })).status).toBe(409);
    // SSE 對終態任務：送出目前狀態後立即結束
    expect((await sse(s.base, u.token, job.id)).map((e) => e.state)).toEqual(['canceled']);
  });

  it('逾時 → failed（任務逾時）＋退款', async () => {
    // 這個 stack 的 jobTimeoutMs = 1500
    const u = await register(s.api);
    const job = await s.jobs.create(auth(u), { type: 'plan_import', input: {}, costEstimate: 6 });
    const j = await until(
      () => s.jobs.get(u.orgId, job.id),
      (x) => x.state === 'failed',
      10_000,
    );
    expect(j.errorMessage).toMatch(/逾時/);
    expect(await balanceOf(u.token)).toBe(20);
  });

  it('其他租戶看不到任務（GET、SSE、取消都 404）', async () => {
    const a = await register(s.api, 'a');
    const b = await register(s.api, 'b');
    const job = await s.jobs.create(auth(a), { type: 'thumbnail', input: {}, costEstimate: 1 });
    expect((await s.api('GET', `/jobs/${job.id}`, { token: b.token })).status).toBe(404);
    expect((await s.api('GET', `/jobs/${job.id}/events`, { token: b.token })).status).toBe(404);
    expect((await s.api('POST', `/jobs/${job.id}/cancel`, { token: b.token })).status).toBe(404);
  });
});
