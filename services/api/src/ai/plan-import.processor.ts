import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/db.js';
import { planImports, uploads } from '../db/schema.js';
import type { Storage } from '../infra/storage.js';
import { JobFailure, type Processor } from '../worker/runtime.js';
import type { VisionProvider } from './vision.js';

interface PlanResultLike {
  source: 'vector' | 'raster';
  units: 'mm' | 'px';
  scale: { method: string; mmPerPx?: number | null };
  walls: unknown[];
  openings: unknown[];
  rooms?: { polygon: [number, number][]; label?: string | null; labelSource?: string; confidence: number }[];
  warnings?: { code: string; message: string }[];
}

const polyAreaM2 = (poly: [number, number][]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2 / 1e6;
};

/**
 * 平面圖辨識任務（06、S6.x）：S3 取檔 → cv-service /v1/parse（逾時 60 s）→ VisionProvider 補房名（不改幾何）→ 存草稿。
 * cv-service 回 422（格式/大小/內容無法解析）＝業務失敗、不重試；連線失敗/5xx 交給 BullMQ 重試。免費任務（不扣點）。
 */
export function createPlanImportProcessor(deps: {
  db: Db;
  storage: Storage;
  cvServiceUrl: string;
  vision: VisionProvider;
  fetchImpl?: typeof fetch;
}): Processor {
  const f = deps.fetchImpl ?? fetch;
  return async ({ job, signal, progress }) => {
    const input = job.input as { uploadId: string; hints?: { scaleMmPerPx?: number } };
    const [u] = await deps.db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, input.uploadId), eq(uploads.orgId, job.orgId)));
    if (!u || u.kind !== 'plan' || u.status !== 'uploaded')
      throw new JobFailure('VALIDATION_FAILED', '平面圖上傳不存在或未完成');
    const bytes = await deps.storage.get(u.storageKey);
    await progress(15);
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array(bytes)], { type: u.mime }),
      u.storageKey.split('/').pop() ?? 'plan',
    );
    if (input.hints?.scaleMmPerPx) form.set('scaleMmPerPx', String(input.hints.scaleMmPerPx));
    const res = await f(`${deps.cvServiceUrl}/v1/parse`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { detail?: { code?: string; message?: string } };
      throw new JobFailure(
        body.detail?.code === 'UPLOAD_REJECTED' ? 'UPLOAD_REJECTED' : 'JOB_FAILED',
        body.detail?.message ?? '無法解析平面圖',
      );
    }
    if (!res.ok) throw new Error(`cv-service ${res.status}`);
    const result = (await res.json()) as PlanResultLike;
    await progress(70);

    // 房名：只寫 label/labelSource，幾何原封不動
    const rooms = result.rooms ?? [];
    if (rooms.length) {
      const labels = await deps.vision.labelRooms(
        rooms.map((r, index) => ({
          index,
          areaM2: result.units === 'mm' ? polyAreaM2(r.polygon) : null,
          ocrLabel: r.label ?? null,
        })),
        signal,
      );
      for (const l of labels) {
        const r = rooms[l.index];
        if (r) {
          r.label = l.label;
          r.labelSource = l.source;
        }
      }
    }
    await deps.db.orm
      .update(planImports)
      .set({
        source: result.source,
        scale: result.scale as Record<string, unknown>,
        draftScene: result as unknown as Record<string, unknown>,
        warnings: result.warnings ?? [],
      })
      .where(eq(planImports.id, job.id));
    return {
      output: {
        planImportId: job.id,
        units: result.units,
        scaleMethod: result.scale.method,
        walls: result.walls.length,
        openings: result.openings.length,
        rooms: rooms.length,
      },
      costActualCredits: 0,
      provenance: { cvService: deps.cvServiceUrl, vision: deps.vision.id, source: result.source },
    };
  };
}
