import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../src/config.js';
import { Storage } from '../../src/infra/storage.js';
import { createPlanImportProcessor } from '../../src/ai/plan-import.processor.js';
import { MockVisionProvider } from '../../src/ai/vision.js';
import { createStack, register, until, type Stack, putObject, fetchRetry } from '../support/stack.js';
import { startCvService } from '../support/cv.js';

const FX = path.join(REPO_ROOT, 'fixtures/plans');
let s: Stack;
let cv: Awaited<ReturnType<typeof startCvService>>;
beforeAll(async () => {
  cv = await startCvService();
  s = await createStack();
  await s.startWorker({
    plan_import: createPlanImportProcessor({
      db: s.appDb,
      storage: new Storage(s.config.s3),
      cvServiceUrl: cv.url,
      vision: new MockVisionProvider(),
    }),
  });
});
afterAll(async () => {
  await s?.close();
  await cv?.stop();
});

async function uploadPlan(token: string, name: string, mime: string, body: Buffer) {
  const t = await s.api('POST', '/uploads', {
    token,
    body: { kind: 'plan', filename: name, mime, sizeBytes: body.length },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  await putObject(t.body.putUrl, t.body.headers, body);
  const done = await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token });
  return { id: t.body.upload.id as string, status: done.status };
}

async function importPlan(token: string, uploadId: string) {
  const j = await s.api('POST', '/plan-imports', {
    token,
    body: { uploadId },
    headers: { 'idempotency-key': `pi-${uploadId}` },
  });
  expect(j.status, JSON.stringify(j.body)).toBe(202);
  expect(j.body.costEstimateCredits).toBe(0);
  return until(
    () => s.api('GET', `/plan-imports/${j.body.id}`, { token }),
    (r) => ['succeeded', 'failed'].includes(r.body.state),
    60_000,
  );
}

describe('平面圖匯入（cv-service，E2E）', () => {
  it('DXF（mm）：牆與門窗、房名文字；尺度來自 $INSUNITS', async () => {
    const u = await register(s.api);
    const meta = JSON.parse(await readFile(path.join(FX, 'synth-filled.json'), 'utf8'));
    const up = await uploadPlan(
      u.token,
      'plan.dxf',
      'application/dxf',
      await readFile(path.join(FX, 'synth-mm.dxf')),
    );
    expect(up.status).toBe(200);
    const r = await importPlan(u.token, up.id);
    expect(r.body.state).toBe('succeeded');
    const res = r.body.result;
    expect(res).toMatchObject({ source: 'vector', units: 'mm', scale: { method: 'dxf_units' } });
    const gt = meta.gt;
    const types = (list: { type: string }[], t: string) => list.filter((o) => o.type === t).length;
    expect(types(res.openings, 'door')).toBe(types(gt.openings, 'door'));
    expect(types(res.openings, 'window')).toBe(types(gt.openings, 'window'));
    const len = (w: { a: number[]; b: number[] }) => Math.hypot(w.b[0]! - w.a[0]!, w.b[1]! - w.a[1]!);
    const tot = (ws: { a: number[]; b: number[] }[]) => ws.reduce((a, w) => a + len(w), 0);
    expect(Math.abs(tot(res.walls) - tot(gt.walls)) / tot(gt.walls)).toBeLessThanOrEqual(0.01);
    expect(res.labels.length).toBe(gt.rooms.length);
    expect(r.body.sourceUrl).toBeNull(); // 向量檔沒有底圖
  });

  it('PNG（點陣）：OCR 房名＋啟發式補名；可取得原圖預簽名 URL；每個元素有信心度', async () => {
    const u = await register(s.api);
    const up = await uploadPlan(
      u.token,
      'plan.png',
      'image/png',
      await readFile(path.join(FX, 'synth-filled.png')),
    );
    const r = await importPlan(u.token, up.id);
    expect(r.body.state).toBe('succeeded');
    const res = r.body.result;
    expect(res.source).toBe('raster');
    expect(res.walls.length).toBeGreaterThan(5);
    expect(res.walls.every((w: { confidence: number }) => w.confidence > 0 && w.confidence <= 1)).toBe(true);
    expect(res.rooms.length).toBeGreaterThan(3);
    expect(res.rooms.every((rm: { label: string | null }) => !!rm.label)).toBe(true);
    expect(res.rooms.some((rm: { labelSource: string }) => rm.labelSource === 'ocr')).toBe(true);
    const img = await fetchRetry(r.body.sourceUrl);
    expect(img.status).toBe(200);
  });

  it('DXF 未設定單位 → 只有像素草稿、scale unknown、要求校正（06 §6）', async () => {
    const u = await register(s.api);
    const up = await uploadPlan(
      u.token,
      'u.dxf',
      'application/dxf',
      await readFile(path.join(FX, 'synth-unitless.dxf')),
    );
    const r = await importPlan(u.token, up.id);
    expect(r.body.result).toMatchObject({ units: 'px', scale: { method: 'unknown', mmPerPx: null } });
    expect(r.body.result.warnings.map((w: { code: string }) => w.code)).toContain('SCALE_UNKNOWN');
  });

  it('cv-service 無法解析（PDF）→ failed＋UPLOAD_REJECTED，不重試', async () => {
    const u = await register(s.api);
    const pdf = Buffer.from('%PDF-1.7\n' + 'x'.repeat(200));
    const up = await uploadPlan(u.token, 'plan.pdf', 'application/pdf', pdf);
    const r = await importPlan(u.token, up.id);
    expect(r.body.state).toBe('failed');
    expect(r.body.errorCode).toBe('UPLOAD_REJECTED');
    const job = await s.api('GET', `/jobs/${r.body.id}`, { token: u.token });
    expect(job.body.retryCount).toBe(0);
  });

  it('上傳用途不是 plan → 422；其他租戶讀不到', async () => {
    const a = await register(s.api, 'a');
    const png = await readFile(path.join(FX, 'synth-filled.png'));
    const t = await s.api('POST', '/uploads', {
      token: a.token,
      body: { kind: 'photo', filename: 'p.png', mime: 'image/png', sizeBytes: png.length },
    });
    await putObject(t.body.putUrl, t.body.headers, png);
    await s.api('POST', `/uploads/${t.body.upload.id}/complete`, { token: a.token });
    const bad = await s.api('POST', '/plan-imports', {
      token: a.token,
      body: { uploadId: t.body.upload.id },
      headers: { 'idempotency-key': 'bad-kind-1' },
    });
    expect(bad.status).toBe(422);
    const up = await uploadPlan(
      a.token,
      'plan.dxf',
      'application/dxf',
      await readFile(path.join(FX, 'synth-mm.dxf')),
    );
    const r = await importPlan(a.token, up.id);
    const b = await register(s.api, 'b');
    expect((await s.api('GET', `/plan-imports/${r.body.id}`, { token: b.token })).status).toBe(404);
  });
});
