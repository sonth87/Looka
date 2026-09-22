import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignTimingRowDao,
  IdentificationStatsDao,
  RosterGroupFieldDao,
  RosterGroupStatDao,
} from '../dao';
import {
  CampaignTimingQueryDto,
  IdentificationStatsQueryDto,
  RosterGroupsQueryDto,
} from '../dto';
import { RosterGroupStatsService } from '../services/roster-group-stats.service';
import { StatsQueryService } from '../services/stats-query.service';
import { defaultDateRange } from '../util/vn-date.util';

/**
 * The two campaign-scoped stats routes §2.1/§2.2 add — declared here in
 * `StatsModule` rather than `device-management`'s own `CampaignController`
 * (both share the `campaigns` path prefix, same convention every other
 * `campaigns/:id/...` controller in this app already follows) to avoid a
 * circular module dependency: `device-management` already imports
 * `StatsModule` (for `DeviceEventService`'s stats hooks), so `StatsModule`
 * must not import `device-management` back just to 404-check `:id` here —
 * an unknown campaign id simply reads back as all-zero/empty stats instead,
 * which is a reasonable, low-risk simplification for a read-only stats
 * endpoint.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('stats')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class CampaignStatsExtraController {
  constructor(
    private readonly statsQuery: StatsQueryService,
    private readonly rosterGroupStats: RosterGroupStatsService,
  ) {}

  @Get(':id/stats/timing')
  @ApiOperation({
    summary:
      'Thời gian trung bình/p50/p95 (quét thẻ → kết thúc), theo kiosk/cán bộ/ngày',
  })
  @ApiResponseArrayDecorator(CampaignTimingRowDao)
  async timing(
    @Param('id') campaignId: string,
    @Query() query: CampaignTimingQueryDto,
  ): Promise<CampaignTimingRowDao[]> {
    const { from, to } = defaultDateRange(query.from, query.to, 30);
    return this.statsQuery.campaignTiming(
      campaignId,
      query.groupBy ?? 'device',
      from,
      to,
    );
  }

  @Get(':id/stats/identification')
  @ApiOperation({ summary: 'Thống kê phương thức định danh của một campaign' })
  @ApiResponseDecorator(IdentificationStatsDao)
  async identification(
    @Param('id') campaignId: string,
    @Query() query: IdentificationStatsQueryDto,
  ): Promise<IdentificationStatsDao> {
    const { from, to } = defaultDateRange(query.from, query.to, 30);
    const byMethod = await this.statsQuery.identificationStats(
      campaignId,
      from,
      to,
    );
    return { byMethod };
  }

  @Get(':id/stats/roster-group-fields')
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:read', 'Xem field nhóm thống kê roster')
  @ApiOperation({
    summary:
      'Các field nhóm được cho thống kê động (cột thật + khoá phát hiện từ API pull)',
  })
  @ApiResponseArrayDecorator(RosterGroupFieldDao)
  rosterGroupFields(
    @Param('id', new ParseUUIDPipe()) campaignId: string,
  ): Promise<RosterGroupFieldDao[]> {
    return this.rosterGroupStats.groupFields(campaignId);
  }

  @Get(':id/stats/roster-groups')
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:read', 'Xem thống kê nhóm roster')
  @ApiOperation({
    summary:
      'Thống kê nhóm động theo 1-2 tầng field (lớp/khoa/ngành/khoá jsonb phát hiện từ API)',
  })
  @ApiResponseArrayDecorator(RosterGroupStatDao)
  rosterGroups(
    @Param('id', new ParseUUIDPipe()) campaignId: string,
    @Query() query: RosterGroupsQueryDto,
  ): Promise<RosterGroupStatDao[]> {
    return this.rosterGroupStats.groupStats(
      campaignId,
      query.groupBy,
      query.secondaryGroupBy,
    );
  }
}
