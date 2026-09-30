import { grayToRGBA, maskToRGBA, type RGBA } from '@interiorai/image-ops';
import { toPng, type GBuffer } from '@interiorai/viewer-3d';
import type { Schemas } from '@interiorai/api-client';
import { API_URL, api, useAuth } from './client';

export type RenderSettings = Schemas['RenderRequest']['settings'];
export type Job = Schemas['Job'];
export type Render = Schemas['Render'];

/** G-buffer 尺寸：保持畫面比例、長邊 1024、16 的倍數（驗證用；輸出解析度另依設定） */
export function gbufferSize(viewW: number, viewH: number, long = 1024) {
  const k = long / Math.max(viewW, viewH);
  const r16 = (v: number) => Math.max(16, Math.round((v * k) / 16) * 16);
  return { width: r16(viewW), height: r16(viewH) };
}

async function uploadPng(img: RGBA, name: string): Promise<string> {
  const blob = await toPng(img);
  const t = await api.post('/uploads', {
    body: { kind: 'gbuffer', filename: `${name}.png`, mime: 'image/png', sizeBytes: blob.size },
  });
  const put = await fetch(t.putUrl, { method: 'PUT', headers: t.headers, body: blob });
  if (!put.ok) throw new Error(`upload ${name} failed: ${put.status}`);
  await api.post('/uploads/{id}/complete', { params: { id: t.upload.id } });
  return t.upload.id;
}

/** 上傳 G-buffer（05 §3-1：送出前產生並存檔以便重現）並建立渲染任務 */
export async function submitRender(
  g: GBuffer,
  target: { projectId: string; versionId: string },
  settings: RenderSettings,
): Promise<Job> {
  const [color, depth, edge, objectId, normal] = await Promise.all([
    uploadPng(g.color, 'color'),
    uploadPng(grayToRGBA(g.depth), 'depth'),
    uploadPng(maskToRGBA(g.edge), 'edge'),
    uploadPng(g.objectId, 'objectId'),
    uploadPng(g.normal, 'normal'),
  ]);
  return api.post('/renders', {
    idempotencyKey: crypto.randomUUID(),
    body: {
      projectId: target.projectId,
      versionId: target.versionId,
      camera: g.meta.camera,
      gbufferUploadIds: { color, depth, edge, objectId, normal },
      idMap: Object.fromEntries(Object.entries(g.idMap).map(([k, v]) => [k, { id: v.id, kind: v.kind }])),
      settings,
    },
  });
}

/**
 * SSE（GET /jobs/{id}/events）：EventSource 不能帶 Authorization 標頭 → 以 fetch 串流解析。
 * 斷線時退回輪詢 GET /jobs/{id}（04 §5）。
 */
export async function watchJob(jobId: string, onEvent: (j: Job) => void, signal: AbortSignal): Promise<Job> {
  const terminal = (s: string) => ['succeeded', 'failed', 'canceled'].includes(s);
  let last: Job | null = null;
  try {
    const r = await fetch(`${API_URL}/jobs/${jobId}/events`, {
      headers: { authorization: `Bearer ${useAuth.getState().token ?? ''}` },
      signal,
    });
    if (r.ok && r.body) {
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!data) continue;
          last = JSON.parse(data) as Job;
          onEvent(last);
        }
      }
    }
  } catch (e) {
    if (signal.aborted) throw e;
  }
  while (!last || !terminal(last.state)) {
    if (signal.aborted) throw signal.reason;
    await new Promise((res) => setTimeout(res, 1000));
    last = await api.get('/jobs/{id}', { params: { id: jobId } });
    onEvent(last);
  }
  return last;
}
