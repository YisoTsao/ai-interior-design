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
 * S3 相容儲存（04 §7）。桶私有；上傳/下載一律用預簽名 URL（PUT 10 分鐘、GET 5 分鐘）。
 * 預簽名用 publicEndpoint 的 client 簽，讓瀏覽器拿到的主機名可連線。
 */
export class Storage {
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
