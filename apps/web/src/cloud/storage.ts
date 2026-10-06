import type { Schemas } from '@interiorai/api-client';
import { api } from './client';

type UploadKind = Schemas['UploadKind'];

/**
 * 物件儲存介面（前端側）：所有「把檔案送上雲端」的地方都經由此介面，
 * 之後改用 Supabase Storage 時只需新增實作並在 blobStore 切換。
 */
export interface BlobStore {
  /** 上傳檔案，回傳後端可引用的 uploadId */
  upload(kind: UploadKind, file: Blob, filename: string, mime: string): Promise<string>;
}

/** 目前實作：向 API 要預簽名 PUT URL（S3 相容）→ 直接上傳 → 通知完成 */
export class PresignedUploadStore implements BlobStore {
  async upload(kind: UploadKind, file: Blob, filename: string, mime: string) {
    const t = await api.post('/uploads', {
      body: { kind, filename, mime, sizeBytes: file.size },
    });
    const put = await fetch(t.putUrl, { method: 'PUT', headers: t.headers, body: file });
    if (!put.ok) throw new Error(`upload ${filename} failed: ${put.status}`);
    await api.post('/uploads/{id}/complete', { params: { id: t.upload.id } });
    return t.upload.id;
  }
}

/** Supabase Storage（尚未實作；DB 改用 Supabase 時接上） */
export class SupabaseBlobStore implements BlobStore {
  upload(): Promise<string> {
    return Promise.reject(new Error('SUPABASE_STORAGE_NOT_IMPLEMENTED'));
  }
}

export const blobStore: BlobStore =
  import.meta.env.VITE_STORAGE_PROVIDER === 'supabase' ? new SupabaseBlobStore() : new PresignedUploadStore();
