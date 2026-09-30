import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { DB } from '../../tokens.js';
import type { Db } from '../../db/db.js';
import { catalogAssets, materials, uploads } from '../../db/schema.js';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { ApiError, notFound } from '../../common/errors.js';
import { uuidParam } from '../projects/projects.controller.js';

type AssetRow = typeof catalogAssets.$inferSelect;
const assetDto = (r: AssetRow) => ({
  id: r.id,
  slug: r.slug,
  nameZh: r.nameZh,
  nameEn: r.nameEn,
  category: r.category,
  tags: r.tags,
  styleTags: r.styleTags,
  dimsMm: r.dimsMm,
  anchor: r.anchor as 'floor' | 'wall' | 'ceiling',
  parametric: r.parametric ?? null,
  materialSlots: r.materialSlots,
  license: r.license,
  status: r.status,
});

/** 資產庫（FR-401/402、B5）：只回 published；使用者上傳的資產進 review，待人工審核授權 */
@Controller()
export class AssetsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('assets')
  async list(@Query() q: { q?: string; category?: string; limit?: number; cursor?: string }) {
    const limit = q.limit ?? 25;
    const text = q.q?.trim();
    const rows = await this.db.orm
      .select()
      .from(catalogAssets)
      .where(
        and(
          eq(catalogAssets.status, 'published'),
          q.category ? eq(catalogAssets.category, q.category) : undefined,
          text
            ? or(
                ilike(catalogAssets.nameZh, `%${text.replace(/[%_\\]/g, '\\$&')}%`),
                ilike(catalogAssets.nameEn, `%${text.replace(/[%_\\]/g, '\\$&')}%`),
                sql`${text} = ANY(${catalogAssets.tags})`,
              )
            : undefined,
          q.cursor ? gt(catalogAssets.slug, q.cursor) : undefined,
        ),
      )
      .orderBy(asc(catalogAssets.slug))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return { items: items.map(assetDto), nextCursor: rows.length > limit ? items.at(-1)!.slug : null };
  }

  @Get('assets/:id')
  async get(@Req() req: R, @Param('id') id: string) {
    const a = authOf(req);
    const [r] = await this.db.orm
      .select()
      .from(catalogAssets)
      .where(eq(catalogAssets.id, uuidParam(id)));
    // 未上架的資產只有上傳者看得到
    if (!r || (r.status !== 'published' && r.createdBy !== a.userId)) throw notFound('資產');
    return assetDto(r);
  }

  @Post('assets')
  @HttpCode(202)
  @MinRole('editor')
  async create(
    @Req() req: R,
    @Body()
    b: {
      slug: string;
      nameZh: string;
      nameEn?: string;
      category: string;
      tags?: string[];
      dimsMm: { w: number; d: number; h: number };
      anchor: string;
      uploadId: string;
      license: Record<string, unknown>;
    },
  ) {
    const a = authOf(req);
    const [u] = await this.db.orm
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, b.uploadId), eq(uploads.orgId, a.orgId)));
    if (!u || u.kind !== 'asset' || u.status !== 'uploaded')
      throw new ApiError('VALIDATION_FAILED', 'uploadId 必須是本組織已完成的資產上傳');
    const [r] = await this.db.orm
      .insert(catalogAssets)
      .values({
        slug: b.slug,
        nameZh: b.nameZh,
        nameEn: b.nameEn,
        category: b.category,
        tags: b.tags ?? [],
        dimsMm: b.dimsMm,
        anchor: b.anchor,
        modelKey: u.storageKey,
        license: b.license,
        status: 'review',
        createdBy: a.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!r) throw new ApiError('CONFLICT', `slug ${b.slug} 已存在`);
    return assetDto(r);
  }

  @Get('materials')
  async materials() {
    const rows = await this.db.orm
      .select()
      .from(materials)
      .where(eq(materials.status, 'published'))
      .orderBy(asc(materials.slug));
    return {
      items: rows.map((m) => ({
        id: m.id,
        slug: m.slug,
        nameZh: m.nameZh,
        category: m.category,
        maps: m.maps,
        realSizeMm: m.realSizeMm,
        status: m.status,
      })),
    };
  }
}
