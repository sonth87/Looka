import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IdentificationStatsDao, StatsHealthDao, StatsJobDao } from '../dao';
import {
  IdentificationStatsQueryDto,
  ListStatsJobsQueryDto,
  RebuildStatsDto,
} from '../dto';
import { StatsJobService } from '../services/stats-job.service';
import { StatsQueryService } from '../services/stats-query.service';
import { StatsRebuildService } from '../services/stats-rebuild.service';
import { defaultDateRange } from '../util/vn-date.util';

/** Operational endpoints — cms-8-screens-api-plan.md §2.9's "Vận hành" group. */
@Controller({ path: 'stats', version: '1' })
@ApiTags('stats')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class StatsOpsController {
  constructor(
    private readonly rebuildService: StatsRebuildService,
    private readonly jobService: StatsJobService,
    private readonly statsQuery: StatsQueryService,
  ) {}

  @Post('rebuild')
  @UseGuards(PermissionsGuard)
  @RequirePermission('stats:rebuild', 'Tính lại thống kê')
  @ApiOperation({
    summary:
      'Tạo job tính lại thống kê cho khoảng ngày (và campaign) đã chọn — chạy nền',
  })
  @ApiResponseDecorator(Object, { status: 202 })
  rebuild(
    @Body() dto: RebuildStatsDto,
    @Req() req: Request,
  ): Promise<{ jobId: string }> {
    return this.rebuildService.rebuild({
      from: dto.from,
      to: dto.to,
      campaignId: dto.campaignId,
      triggeredByUserId: req.user?.id ?? null,
    });
  }

  @Get('jobs')
  @ApiOperation({
    summary: 'Lịch sử các lần tính thống kê (cron + rebuild tay)',
  })
  async listJobs(@Query() query: ListStatsJobsQueryDto): Promise<{
    items: StatsJobDao[];
    meta: {
      itemCount: number;
      totalItems: number;
      itemsPerPage: number;
      totalPages: number;
      currentPage: number;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { items, total } = await this.jobService.list({
      kind: query.kind,
      status: query.status,
      page,
      limit,
    });
    return {
      items,
      meta: {
        itemCount: items.length,
        totalItems: total,
        itemsPerPage: limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        currentPage: page,
      },
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Lần chạy cuối + độ trễ của 2 cron thống kê' })
  @ApiResponseDecorator(StatsHealthDao)
  health(): ReturnType<StatsJobService['health']> {
    return this.jobService.health();
  }

  @Get('identification')
  @ApiOperation({ summary: 'Thống kê phương thức định danh toàn hệ thống' })
  @ApiResponseDecorator(IdentificationStatsDao)
  async identification(
    @Query() query: IdentificationStatsQueryDto,
  ): Promise<IdentificationStatsDao> {
    const { from, to } = defaultDateRange(query.from, query.to, 30);
    const byMethod = await this.statsQuery.identificationStats(null, from, to);
    return { byMethod };
  }
}
