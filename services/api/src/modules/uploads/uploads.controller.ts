import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, STORAGE } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { uploads } from '../../db/schema.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { ApiError, notFound } from '../../common/errors.js';
import { uuidParam } from '../projects/projects.controller.js';
import { checkDeclared, safeFilename, sniff, type UploadKind } from './upload-policy.js';

type UploadRow = typeof uploads.$inferSelect;
export const uploadDto = (u: UploadRow) => ({
  id: u.id,
  kind: u.kind as UploadKind,
  mime: u.mime,
  sizeBytes: u.sizeBytes,
  status: u.status as 'pending' | 'uploaded' | 'rejected',
  createdAt: u.createdAt.toISOString(),
});

const PUT_TTL = 600;

@Controller()
export class UploadsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Post('uploads')
  @HttpCode(201)
  @MinRole('editor')
  async create(
    @Req() req: R,
    @Body() b: { kind: UploadKind; filename: string; mime: string; sizeBytes: number; sha256?: string },
  ) {
    const a = authOf(req);
    const pol = checkDeclared(b.kind, b.filename, b.mime, b.sizeBytes);
    if (!pol.ok) throw new ApiError('UPLOAD_REJECTED', pol.reason);
    const id = randomUUID();
    const now = new Date();
    const key = `uploads/${a.orgId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/${safeFilename(b.filename)}`;
    const [u] = await this.db.orm
      .insert(uploads)
      .values({
        id,
        orgId: a.orgId,
        userId: a.userId,
        kind: b.kind,
        storageKey: key,
        mime: b.mime.toLowerCase(),
        sizeBytes: b.sizeBytes,
        sha256: b.sha256,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      .returning();
    return {
      upload: uploadDto(u!),
      putUrl: await this.storage.putUrl(key, u!.mime, b.sizeBytes, PUT_TTL),
      headers: { 'Content-Type': u!.mime },
      expiresIn: PUT_TTL,
    };
  }

  /** 完成：物件存在、大小與宣告一致、檔頭格式與宣告的 mime 一致；否則標 rejected 並回 422 */
  @Post('uploads/:id/complete')
  @HttpCode(200)
  @MinRole('editor')
  async complete(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const [u] = await this.db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, uuidParam(id)), eq(uploads.orgId, a.orgId)));
    if (!u) throw notFound('上傳');
    if (u.status !== 'pending') return uploadDto(u);
    const head = await this.storage.head(u.storageKey);
    let reason: string | null = null;
    if (!head) reason = '尚未收到檔案';
    else if (head.size !== u.sizeBytes) reason = `檔案大小 ${head.size} 與宣告 ${u.sizeBytes} 不符`;
    else {
      const got = sniff(await this.storage.get(u.storageKey, 64));
      const want = checkDeclared(u.kind as UploadKind, 'x', u.mime, u.sizeBytes);
      if (!want.ok || got !== want.type) reason = `檔案內容（${got ?? '未知格式'}）與宣告的 ${u.mime} 不符`;
    }
    if (!head) throw new ApiError('UPLOAD_REJECTED', reason!);
    const [done] = await this.db.orm
      .update(uploads)
      .set({ status: reason ? 'rejected' : 'uploaded' })
      .where(eq(uploads.id, u.id))
      .returning();
    if (reason) throw new ApiError('UPLOAD_REJECTED', reason, { upload: uploadDto(done!) });
    return uploadDto(done!);
  }
}
