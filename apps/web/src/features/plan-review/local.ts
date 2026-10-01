import { createStore, del, get, set } from 'idb-keyval';
import {
  detectKind,
  PlanParseError,
  recognizeDxf,
  recognizeRoomPlan,
  type PlanResult,
} from '@interiorai/plan-recognition';

/**
 * 平面圖匯入（不需登入、不需後端）：在瀏覽器辨識 → 暫存匯入工作階段（IndexedDB）→ 校正頁。
 * 設定 VITE_CV_URL（cv-service，例：http://localhost:8100）時，點陣圖優先交給服務辨識（有 OCR 尺度與房名），
 * 服務無法連線則退回瀏覽器辨識。
 */
export interface ImportSession {
  id: string;
  fileName: string;
  createdAt: string;
  result: PlanResult;
  /** 點陣底圖（辨識用的影像，可能已縮小） */
  image: Blob | null;
  engine: 'browser' | 'cv-service' | 'roomplan';
}

const store = createStore('interiorai-imports', 'sessions');
const CV_URL = import.meta.env.VITE_CV_URL as string | undefined;
/** 瀏覽器辨識的長邊上限：更大的圖先縮小（速度與記憶體） */
export const MAX_RECOGNIZE_SIDE = 2400;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const loadSession = (id: string) => get<ImportSession>(id, store);
export const deleteSession = (id: string) => del(id, store);

async function viaCvService(file: File): Promise<PlanResult | null> {
  if (!CV_URL) return null;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${CV_URL.replace(/\/$/, '')}/v1/parse`, { method: 'POST', body: fd });
    if (!r.ok) {
      const b = (await r.json().catch(() => null)) as { detail?: { code?: string; message?: string } } | null;
      if (r.status === 422 && b?.detail?.code === 'UPLOAD_REJECTED')
        throw new PlanParseError('UPLOAD_REJECTED', b.detail.message ?? 'rejected');
      return null;
    }
    return (await r.json()) as PlanResult;
  } catch (e) {
    if (e instanceof PlanParseError) throw e;
    return null; // 服務沒開 → 瀏覽器辨識
  }
}

async function decodeImage(file: File): Promise<{ data: ImageData; blob: Blob }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_RECOGNIZE_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = k < 1 ? await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png')) : file;
  return { data: g.getImageData(0, 0, w, h), blob };
}

function inWorker(img: ImageData): Promise<PlanResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      e: MessageEvent<{ ok: boolean; result?: PlanResult; code?: string; message?: string }>,
    ) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else
        reject(
          new PlanParseError(
            e.data.code === 'UPLOAD_REJECTED' ? 'UPLOAD_REJECTED' : 'PARSE_FAILED',
            e.data.message ?? '',
          ),
        );
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new PlanParseError('PARSE_FAILED', e.message));
    };
    const buf = img.data.buffer.slice(0);
    worker.postMessage({ rgba: buf, width: img.width, height: img.height }, [buf]);
  });
}

export async function recognizePlanFile(file: File): Promise<ImportSession> {
  if (file.size > MAX_FILE_BYTES) throw new PlanParseError('UPLOAD_REJECTED', 'TOO_LARGE');
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const kind = detectKind(head, file.name);
  let result: PlanResult;
  let image: Blob | null = null;
  let engine: ImportSession['engine'] = 'browser';
  if (kind === 'vector') {
    result = recognizeDxf(await file.text());
  } else if (kind === 'roomplan') {
    // 手機 LiDAR 掃描（Apple RoomPlan CapturedRoom JSON，FE-MOB-04）
    result = recognizeRoomPlan(await file.text());
    engine = 'roomplan';
  } else {
    const remote = await viaCvService(file);
    if (remote) {
      result = remote;
      image = file;
      engine = 'cv-service';
    } else {
      const { data, blob } = await decodeImage(file);
      result = await inWorker(data);
      image = blob;
    }
  }
  const session: ImportSession = {
    id: `imp_${crypto.randomUUID().replace(/-/g, '')}`,
    fileName: file.name,
    createdAt: new Date().toISOString(),
    result,
    image,
    engine,
  };
  await set(session.id, session, store);
  return session;
}
