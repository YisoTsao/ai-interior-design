import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { AuditService } from '../../common/audit.service.js';
import { ApiError } from '../../common/errors.js';
import { ProjectsService } from './projects.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 路徑參數格式由契約定義為 uuid；在進資料庫前擋掉，避免 uuid 轉型錯誤變成 500 */
export const uuidParam = (v: string) => {
  if (!UUID.test(v)) throw new ApiError('NOT_FOUND', '找不到資源');
  return v;
};

@Controller()
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly svc: ProjectsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('projects')
  list(@Req() req: R, @Query() q: { limit?: number; cursor?: string }) {
    return this.svc.list(authOf(req), q.limit ?? 25, q.cursor);
  }

  @Post('projects')
  @HttpCode(201)
  @MinRole('editor')
  create(@Req() req: R, @Body() b: { name: string }) {
    return this.svc.create(authOf(req), b.name);
  }

  @Get('projects/:id')
  get(@Req() req: R, @Param('id') id: string) {
    return this.svc.get(authOf(req), uuidParam(id));
  }

  @Patch('projects/:id')
  @MinRole('editor')
  patch(@Req() req: R, @Param('id') id: string, @Body() b: { name: string }) {
    return this.svc.rename(authOf(req), uuidParam(id), b.name);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  @MinRole('editor')
  async remove(@Req() req: R, @Param('id') id: string) {
    await this.svc.remove(authOf(req), uuidParam(id));
    await this.audit.record(req, { action: 'project.delete', targetType: 'project', targetId: id });
  }

  @Get('projects/:id/versions')
  versions(@Req() req: R, @Param('id') id: string) {
    return this.svc.versions(authOf(req), uuidParam(id));
  }

  @Post('projects/:id/versions')
  @MinRole('editor')
  async save(
    @Req() req: R,
    @Param('id') id: string,
    @Body() b: { baseVersionId: string | null; scene: unknown; note?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.saveVersion(authOf(req), uuidParam(id), b);
    res.status(r.created ? 201 : 200);
    return r.version;
  }

  @Get('versions/:id')
  version(@Req() req: R, @Param('id') id: string) {
    return this.svc.getVersion(authOf(req), uuidParam(id));
  }

  @Post('projects/:id/restore/:versionId')
  @HttpCode(200)
  @MinRole('editor')
  async restore(@Req() req: R, @Param('id') id: string, @Param('versionId') vid: string) {
    const p = await this.svc.restore(authOf(req), uuidParam(id), uuidParam(vid));
    await this.audit.record(req, {
      action: 'project.restore',
      targetType: 'project',
      targetId: id,
      meta: { versionId: vid },
    });
    return p;
  }
}
