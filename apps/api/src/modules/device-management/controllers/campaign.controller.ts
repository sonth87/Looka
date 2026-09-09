import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/common/decorators';
import { SsoAuthGuard } from '@app/common/guards';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllCampaignsStatsDao,
  CampaignDao,
  CampaignsTimeseriesDao,
  CampaignStatsDao,
} from '../dao';
import {
  CreateCampaignDto,
  GetCampaignsTimeseriesQueryDto,
  UpdateCampaignDto,
} from '../dto';
import { CampaignService } from '../services/campaign.service';
import { DeviceEventService } from '../services/device-event.service';

/**
 * CMS/admin surface only - a human operator managing campaigns through the
 * CMS. Moved from the shared `x-api-key` to `SsoAuthGuard` as part of the
 * 2026-09-07 decision to retire api-key from CMS/admin surfaces now that the
 * CMS has real SSO login (docs/LOGIN.md).
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly deviceEventService: DeviceEventService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a campaign — a named group of devices sharing one expiry/consent/capture config',
  })
  @ApiResponseDecorator(CampaignDao, { status: 201 })
  createCampaign(@Body() dto: CreateCampaignDto): Promise<CampaignDao> {
    return this.campaignService.createCampaign(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  @ApiResponseArrayDecorator(CampaignDao)
  listCampaigns(): Promise<CampaignDao[]> {
    return this.campaignService.findAllCampaigns();
  }

  /**
   * Overview page for the CMS — one grand total across every campaign, plus
   * the per-campaign breakdown it was summed from (see
   * `AllCampaignsStatsDao`'s own doc comment). Declared before the `:id`
   * routes below, and under a 3-segment path (`stats/summary`) that can't be
   * captured by `:id` (which only ever matches a single segment) or by
   * `:id/stats` (whose last segment is the literal `stats`, not `summary`)
   * — this codebase has already been bitten once by an unconstrained `:id`
   * route shadowing a more specific one (see DeviceController's own history
   * here), so this is deliberate, not incidental.
   */
  @Get('stats/summary')
  @ApiOperation({
    summary:
      'Get event-count stats summed across every campaign, plus the per-campaign breakdown',
  })
  @ApiResponseDecorator(AllCampaignsStatsDao)
  async getAllCampaignsStats(): Promise<AllCampaignsStatsDao> {
    const campaigns = await this.campaignService.findAllCampaigns();
    return this.deviceEventService.allCampaignsStats(
      campaigns.map((c) => ({ id: c.id, name: c.name })),
    );
  }

  /**
   * Trend charts for the CMS Overview page (2026-09-07 dashboard redesign) —
   * sessions-completed, uploads-success/failed, and retake device-event
   * counts, bucketed by day across every campaign (see
   * `CampaignsTimeseriesDao`'s own doc comment). Declared under the same
   * `stats/...` prefix and for the same route-shadowing reason as
   * `stats/summary` above.
   */
  @Get('stats/timeseries')
  @ApiOperation({
    summary:
      'Get daily sessions-completed / uploads-success / uploads-failed / retake series across every campaign',
  })
  @ApiResponseDecorator(CampaignsTimeseriesDao)
  getCampaignsTimeseries(
    @Query() query: GetCampaignsTimeseriesQueryDto,
  ): Promise<CampaignsTimeseriesDao> {
    return this.deviceEventService.campaignsTimeseries(query.days ?? 14);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one campaign' })
  @ApiResponseDecorator(CampaignDao)
  getCampaign(@Param('id') id: string): Promise<CampaignDao> {
    return this.campaignService.findCampaignOrFail(id);
  }

  /**
   * Extend/renew (or clear back to permanent), edit consent text, or change
   * capture config — every device already registered under this campaign
   * picks up the change immediately, since none of these fields are
   * duplicated onto the device row (see the service's own doc comment).
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a campaign (expiry, consent, capture config)',
  })
  @ApiResponseDecorator(CampaignDao)
  updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignDao> {
    return this.campaignService.updateCampaign(id, dto);
  }

  /**
   * Hard-deletes a campaign — refused with a 409 (`CAMPAIGN_HAS_DEPENDENCIES`)
   * when it still has any devices or capture sessions attached; see
   * `CampaignService.deleteCampaign`'s own doc comment for the full cascade
   * reasoning (devices cascade-delete, sessions/photos would only be
   * orphaned — both surprising enough to refuse rather than silently do).
   */
  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a campaign — refused with 409 if it still has any devices or capture sessions attached',
  })
  async deleteCampaign(@Param('id') id: string): Promise<{ id: string }> {
    await this.campaignService.deleteCampaign(id);
    return { id };
  }

  /**
   * The "tối thiểu cần có" snapshot from
   * docs/plans/multi-camera-device-management-discussion.md §3.4 — counts
   * fed by whatever kiosks under this campaign have pushed to
   * `POST /v1/devices/events` so far. Zero for every field until at least
   * one kiosk is actually reporting.
   */
  @Get(':id/stats')
  @ApiOperation({ summary: 'Get event-count stats for a campaign' })
  @ApiResponseDecorator(CampaignStatsDao)
  async getCampaignStats(@Param('id') id: string): Promise<CampaignStatsDao> {
    await this.campaignService.findCampaignEntityOrFail(id);
    return this.deviceEventService.campaignStats(id);
  }
}
