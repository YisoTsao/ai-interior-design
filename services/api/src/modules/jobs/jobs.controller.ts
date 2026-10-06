import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type MessageEvent,
} from '@nestjs/common';
import { ReplaySubject, concat, finalize, from, map, takeWhile, type Observable } from 'rxjs';
import { authOf, type Req as R } from '../../common/context.js';
import { MinRole } from '../../common/guard.js';
import { uuidParam } from '../projects/projects.controller.js';
import type { JobEvent, JobEvents } from './job-events.js';
import { isTerminal, type JobState } from './job-state.js';
import { JOB_EVENTS, JobsService, toJobDto } from './jobs.service.js';

/**
 * SSE 的存取檢查必須在 Guard：Nest 不會等 @Sse() handler 完成就送出 200 與串流標頭，
 * handler 內丟的 404 只會變成串流中的錯誤事件（跨租戶會拿到 200）。
 */
@Injectable()
export class JobAccessGuard implements CanActivate {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<R>();
    await this.jobs.get(authOf(req).orgId, uuidParam(String(req.params.id)));
    return true;
  }
}

@Controller()
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(JOB_EVENTS) private readonly events: JobEvents,
  ) {}

  @Get('jobs/:id')
  async get(@Req() req: R, @Param('id') id: string) {
    return toJobDto(await this.jobs.get(authOf(req).orgId, uuidParam(id)));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @MinRole('editor')
  async cancel(@Req() req: R, @Param('id') id: string) {
    return toJobDto(await this.jobs.cancel(authOf(req).orgId, uuidParam(id)));
  }

  /**
   * SSE：先送目前狀態，再轉送事件；終態後關閉。先訂閱再查詢，避免兩者之間的事件遺失。
   * 斷線可用 GET /jobs/{id} 補（04 §5）。
   */
  @Sse('jobs/:id/events')
  @UseGuards(JobAccessGuard)
  async events$(@Req() req: R, @Param('id') id: string): Promise<Observable<MessageEvent>> {
    const orgId = authOf(req).orgId;
    uuidParam(id);
    await this.events.ready();
    const buf = new ReplaySubject<JobEvent>();
    const sub = this.events.stream(id).subscribe(buf);
    let current;
    try {
      current = await this.jobs.get(orgId, id); // RLS：跨租戶 → 404
    } catch (e) {
      sub.unsubscribe();
      throw e;
    }
    return concat(from([toJobDto(current)]), isTerminal(current.state) ? from<JobEvent[]>([]) : buf).pipe(
      takeWhile((e) => !isTerminal(e.state as JobState), true),
      finalize(() => sub.unsubscribe()),
      map((e) => ({ type: 'job', data: e, id: `${e.id}:${e.state}:${e.progress}` })),
    );
  }
}
