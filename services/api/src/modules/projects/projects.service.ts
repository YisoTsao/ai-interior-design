import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { migrate, SchemaUnsupportedError, validateScene } from '@interiorai/scene-schema';
import { DB, STORAGE } from '../../tokens.js';
import type { Db, Tx } from '../../db/db.js';
import { projects, projectVersions } from '../../db/schema.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { ApiError, notFound } from '../../common/errors.js';
import type { AuthContext } from '../../common/context.js';
import { stableStringify } from '../../common/idempotency.interceptor.js';
import { sha256 } from '../auth/tokens.js';

type ProjectRow = typeof projects.$inferSelect;
type VersionRow = typeof projectVersions.$inferSelect;

export const projectDto = (p: ProjectRow) => ({
  id: p.id,
  name: p.name,
  thumbnailUrl: null,
  currentVersionId: p.currentVersionId,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});
export const versionDto = (v: VersionRow) => ({
  id: v.id,
  projectId: v.projectId,
  parentVersionId: v.parentVersionId,
  schemaVersion: v.schemaVersion,
  contentHash: v.contentHash,
  note: v.note,
  createdBy: v.createdBy,
  createdAt: v.createdAt.toISOString(),
});

const encodeCursor = (p: ProjectRow) =>
  Buffer.from(`${p.updatedAt.toISOString()}|${p.id}`).toString('base64url');
function decodeCursor(c: string): [Date, string] {
  const [t, id] = Buffer.from(c, 'base64url').toString().split('|');
  const d = new Date(t ?? '');
  if (Number.isNaN(d.getTime()) || !id) throw new ApiError('VALIDATION_FAILED', 'cursor 無效');
  return [d, id];
}

/**
 * 專案與版本（FR-701、B7）。所有查詢都在 SET LOCAL app.org_id 的交易內 → RLS 第二道防線。
 * 版本不可變（內容雜湊）；儲存需帶 baseVersionId（樂觀鎖），不符回 409 並附最新版本。
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(a: AuthContext, limit: number, cursor?: string) {
    const c = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db.tx(a.orgId, (tx) =>
      tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.orgId, a.orgId),
            isNull(projects.deletedAt),
            c
              ? or(lt(projects.updatedAt, c[0]), and(eq(projects.updatedAt, c[0]), lt(projects.id, c[1])))
              : undefined,
          ),
        )
        .orderBy(desc(projects.updatedAt), desc(projects.id))
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit);
    return {
      items: items.map(projectDto),
      nextCursor: rows.length > limit ? encodeCursor(items.at(-1)!) : null,
    };
  }

  async create(a: AuthContext, name: string) {
    const [p] = await this.db.tx(a.orgId, (tx) =>
      tx.insert(projects).values({ orgId: a.orgId, ownerId: a.userId, name }).returning(),
    );
    return projectDto(p!);
  }

  private async load(tx: Tx, a: AuthContext, id: string, lock = false) {
    const q = tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.orgId, a.orgId), isNull(projects.deletedAt)));
    const [p] = await (lock ? q.for('update') : q);
    if (!p) throw notFound('專案');
    return p;
  }

  get(a: AuthContext, id: string) {
    return this.db.tx(a.orgId, (tx) => this.load(tx, a, id)).then(projectDto);
  }

  async rename(a: AuthContext, id: string, name: string) {
    return this.db.tx(a.orgId, async (tx) => {
      await this.load(tx, a, id, true);
      const [p] = await tx
        .update(projects)
        .set({ name, updatedAt: sql`now()` })
        .where(eq(projects.id, id))
        .returning();
      return projectDto(p!);
    });
  }

  async remove(a: AuthContext, id: string) {
    await this.db.tx(a.orgId, async (tx) => {
      await this.load(tx, a, id, true);
      await tx
        .update(projects)
        .set({ deletedAt: sql`now()` })
        .where(eq(projects.id, id));
    });
  }

  async versions(a: AuthContext, id: string) {
    return this.db.tx(a.orgId, async (tx) => {
      await this.load(tx, a, id);
      const rows = await tx
        .select()
        .from(projectVersions)
        .where(eq(projectVersions.projectId, id))
        .orderBy(desc(projectVersions.createdAt), desc(projectVersions.id));
      return { items: rows.map(versionDto) };
    });
  }

  /** 讀入與寫出都必須通過 Scene 驗證（B2）；舊版 schema 先 migrate */
  private checkScene(input: unknown) {
    let migrated: unknown;
    try {
      migrated = migrate(input);
    } catch (e) {
      if (e instanceof SchemaUnsupportedError) throw new ApiError('SCHEMA_UNSUPPORTED', e.message);
      throw e;
    }
    const v = validateScene(migrated);
    if (!v.ok) throw new ApiError('VALIDATION_FAILED', 'Scene 驗證失敗', v.issues.slice(0, 50));
    return v.scene!;
  }

  async saveVersion(
    a: AuthContext,
    projectId: string,
    body: { baseVersionId: string | null; scene: unknown; note?: string },
  ): Promise<{ created: boolean; version: ReturnType<typeof versionDto> }> {
    const scene = this.checkScene(body.scene);
    const json = stableStringify(scene);
    const hash = sha256(json);
    return this.db.tx(a.orgId, async (tx) => {
      const p = await this.load(tx, a, projectId, true);
      if ((p.currentVersionId ?? null) !== body.baseVersionId) {
        const [latest] = p.currentVersionId
          ? await tx.select().from(projectVersions).where(eq(projectVersions.id, p.currentVersionId))
          : [];
        throw new ApiError('VERSION_CONFLICT', '專案已被其他人更新，請先合併最新版本', {
          latest: latest ? versionDto(latest) : null,
        });
      }
      // 相同內容 → 不產生新版本（UNIQUE(project_id, content_hash)）；指回既有版本
      const [same] = await tx
        .select()
        .from(projectVersions)
        .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.contentHash, hash)));
      if (same) {
        if (p.currentVersionId !== same.id)
          await tx
            .update(projects)
            .set({ currentVersionId: same.id, updatedAt: sql`now()` })
            .where(eq(projects.id, projectId));
        return { created: false, version: versionDto(same) };
      }
      const id = randomUUID();
      const sceneKey = `projects/${a.orgId}/${projectId}/versions/${id}/scene.json`;
      // 先寫物件再寫資料列：交易失敗只會留下孤兒物件（由生命週期規則清除），不會有指向不存在物件的版本
      await this.storage.put(sceneKey, json, 'application/json');
      const [v] = await tx
        .insert(projectVersions)
        .values({
          id,
          projectId,
          parentVersionId: p.currentVersionId,
          schemaVersion: scene.schemaVersion,
          contentHash: hash,
          sceneKey,
          createdBy: a.userId,
          note: body.note,
        })
        .returning();
      await tx
        .update(projects)
        .set({ currentVersionId: id, updatedAt: sql`now()` })
        .where(eq(projects.id, projectId));
      return { created: true, version: versionDto(v!) };
    });
  }

  async getVersion(a: AuthContext, versionId: string) {
    const v = await this.db.tx(a.orgId, async (tx) => {
      const [row] = await tx
        .select({ v: projectVersions })
        .from(projectVersions)
        .innerJoin(projects, eq(projects.id, projectVersions.projectId))
        .where(
          and(eq(projectVersions.id, versionId), eq(projects.orgId, a.orgId), isNull(projects.deletedAt)),
        );
      return row?.v;
    });
    if (!v) throw notFound('版本');
    const scene = JSON.parse((await this.storage.get(v.sceneKey)).toString('utf8'));
    return { ...versionDto(v), scene: this.checkScene(scene) };
  }

  async restore(a: AuthContext, projectId: string, versionId: string) {
    return this.db.tx(a.orgId, async (tx) => {
      await this.load(tx, a, projectId, true);
      const [v] = await tx
        .select()
        .from(projectVersions)
        .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId)));
      if (!v) throw notFound('版本');
      const [p] = await tx
        .update(projects)
        .set({ currentVersionId: versionId, updatedAt: sql`now()` })
        .where(eq(projects.id, projectId))
        .returning();
      return projectDto(p!);
    });
  }
}
