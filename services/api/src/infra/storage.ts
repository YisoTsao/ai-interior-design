import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';

/**
 * 物件儲存介面（04 §7）：所有需要 S3 的地方（上傳、G-buffer、渲染結果、場景版本）都只依賴此介面。
 * 實作：S3Storage（S3 相容，含 MinIO；目前使用）、SupabaseStorage（尚未實作，DB 改用 Supabase 時接上）。
 */
export interface ObjectStorage {
  readonly bucket: string;
  /** 確保桶存在（啟動時呼叫） */
  ensureBucket(): Promise<void>;
  /** 瀏覽器直傳用的預簽名 PUT URL */
  putUrl(key: string, mime: string, size: number, expiresIn?: number): Promise<string>;
  /** 暫時下載 URL */
  getUrl(key: string, expiresIn?: number): Promise<string>;
  put(key: string, body: Buffer | string, mime: string): Promise<void>;
  head(key: string): Promise<{ size: number; mime?: string } | null>;
  /** 讀取物件（可指定前 n bytes，用於檢查檔頭 magic bytes） */
  get(key: string, firstBytes?: number): Promise<Buffer>;
}

/** 依設定建立儲存實作 */
export function createStorage(cfg: Pick<AppConfig, 'storageProvider' | 's3' | 'supabase'>): ObjectStorage {
  return cfg.storageProvider === 'supabase' ? new SupabaseStorage(cfg.supabase) : new S3Storage(cfg.s3);
}

/**
 * Supabase Storage（介面佔位，尚未實作）：之後以 @supabase/supabase-js 的 storage.from(bucket)
 * createSignedUploadUrl／createSignedUrl／upload／download 對應各方法。
 */
export class SupabaseStorage implements ObjectStorage {
  readonly bucket: string;
  constructor(cfg: AppConfig['supabase']) {
    this.bucket = cfg.bucket;
  }
  private todo(op: string): never {
    throw new Error(`SupabaseStorage.${op} 尚未實作（STORAGE_PROVIDER=supabase）`);
  }
  ensureBucket(): Promise<void> {
    return Promise.resolve(this.todo('ensureBucket'));
  }
  putUrl(): Promise<string> {
    return Promise.resolve(this.todo('putUrl'));
  }
  getUrl(): Promise<string> {
    return Promise.resolve(this.todo('getUrl'));
  }
  put(): Promise<void> {
    return Promise.resolve(this.todo('put'));
  }
  head(): Promise<{ size: number; mime?: string } | null> {
    return Promise.resolve(this.todo('head'));
  }
  get(): Promise<Buffer> {
    return Promise.resolve(this.todo('get'));
  }
}

/**
 * S3 相容儲存。桶私有；上傳/下載一律用預簽名 URL（PUT 10 分鐘、GET 5 分鐘）。
 * 預簽名用 publicEndpoint 的 client 簽，讓瀏覽器拿到的主機名可連線。
 */
export class S3Storage implements ObjectStorage {
  private readonly s3: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;
  constructor(cfg: AppConfig['s3']) {
    const base = {
      region: cfg.region,
      // 物件儲存的暫時性錯誤（socket hang up 等）由 SDK 重試；仍失敗才交給 BullMQ 重跑整個任務
      maxAttempts: 5,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    };
    this.s3 = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.signer = new S3Client({ ...base, endpoint: cfg.publicEndpoint });
    this.bucket = cfg.bucket;
  }

  async ensureBucket() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  putUrl(key: string, mime: string, size: number, expiresIn = 600) {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mime, ContentLength: size }),
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  getUrl(key: string, expiresIn = 300) {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async put(key: string, body: Buffer | string, mime: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        ServerSideEncryption: undefined,
      }),
    );
  }

  async head(key: string): Promise<{ size: number; mime?: string } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), mime: r.ContentType };
    } catch {
      return null;
    }
  }

  /** 讀取物件（可指定前 n bytes，用於檢查檔頭 magic bytes） */
  async get(key: string, firstBytes?: number): Promise<Buffer> {
    const r = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: firstBytes ? `bytes=0-${firstBytes - 1}` : undefined,
      }),
    );
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

/** @deprecated 相容舊名稱；新程式請用 ObjectStorage／createStorage */
export { S3Storage as Storage };
