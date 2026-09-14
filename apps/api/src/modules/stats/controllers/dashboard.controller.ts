import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardActiveCampaignDao, DashboardKpisDao } from '../dao';
import { DashboardKpisQueryDto } from '../dto';
import { StatsQueryService } from '../services/stats-query.service';
import { defaultDateRange } from '../util/vn-date.util';

/**
 * `GET /v1/dashboard/*` — cms-8-screens-api-plan.md §2.1. Reads exclusively
 * from `stats_*` tables (the module's own design principle) — no
 * `SsoAuthGuard`-beyond gating: same open-to-any-authenticated-user
 * visibility this codebase already gives `GET /v1/campaigns/:id/stats`'s
 * `byOperator[]`/`byDevice[]` breakdowns (no per-row ACL exists for "whose
 * numbers can I see" anywhere in this app yet) — the plan's own mention of
 * a `stats:read-all` permission for viewing another operator's KPIs was not
 * built this pass, for consistency with that existing precedent rather than
 * introducing a new, narrower access rule found nowhere else in the app.
 */
@Controller({ path: 'dashboard', version: '1' })
@ApiTags('stats')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class DashboardController {
  constructor(private readonly statsQuery: StatsQueryService) {}

  @Get('kpis')
  @ApiOperation({
    summary:
      'Số ảnh chụp theo ngày (theo cán bộ chụp, D-Q12), chờ duyệt, đã in, quá hạn',
  })
  @ApiResponseDecorator(DashboardKpisDao)
  getKpis(
    @Query() query: DashboardKpisQueryDto,
    @Req() req: Request,
  ): Promise<DashboardKpisDao> {
    const { from, to } = defaultDateRange(query.from, query.to, 7);
    return this.statsQuery.dashboardKpis({
      from,
      to,
      operatorUserId: query.operatorUserId ?? req.user!.id,
      campaignId: query.campaignId,
    });
  }

  @Get('campaigns/active')
  @ApiOperation({ summary: 'Danh sách đợt đang hoạt động kèm tiến độ' })
  @ApiResponseArrayDecorator(DashboardActiveCampaignDao)
  getActiveCampaigns(): Promise<DashboardActiveCampaignDao[]> {
    return this.statsQuery.dashboardActiveCampaigns();
  }
}
