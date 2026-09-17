import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { Pagination } from '@app/shared/http/pagination';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
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
  ListCampaignsQueryDto,
  UpdateCampaignDto,
} from '../dto';
import { CampaignService } from '../services/campaign.service';
import { DeviceEventService } from '../services/device-event.service';

/**
 * CMS/admin surface only - a human operator managing campaigns through the
 * CMS. Moved from the shared `x-api-key` to `SsoAuthGuard` as part of the
 * 2026-09-07 decision to retire api-key from CMS/admin surfaces now that the
 * CMS has real SSO login (docs/LOGIN.md).
 *
 * Create/update/delete gained `PermissionsGuard` on 2026-09-11
 * (cms-8-screens-api-plan.md §7 I-Q — "any authenticated SSO user could
 * delete a campaign", since this controller previously had only
 * `SsoAuthGuard`). `isAdmin` accounts are unaffected (the guard's fast
 * path); everyone else needs `campaign:write`/`campaign:delete` granted
 * via a role (`modules/identity`). Read routes (list/get/stats) are
 * deliberately left as `SsoAuthGuard`-only, unchanged — narrowing those
 * too is a separate product decision, not bundled into this fix.
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
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:write', 'Tạo đợt chụp')
  @ApiOperation({
    summary:
      'Create a campaign — a named group of devices sharing one expiry/consent/capture config',
  })
  @ApiResponseDecorator(CampaignDao, { status: 201 })
  createCampaign(@Body() dto: CreateCampaignDto): Promise<CampaignDao> {
    return this.campaignService.createCampaign(dto);
  }

  /**
   * §9.1 backward-compat rule 6: returns the legacy plain array (no
   * filters) when `page` is omitted, and only switches to `{items, meta}`
   * — with the new `status`/`workflowId`/`from`/`to`/`q` filters and
   * `progress` — once the caller opts in by passing `page`. See
   * `ListCampaignsQueryDto`'s own doc comment for why `page` has no default
   * value here (unlike every other paginated list in this codebase).
   */
  @Get()
  @ApiOperation({
    summary:
      'List campaigns — plain array if `page` is omitted (legacy), paginated+filtered otherwise',
  })
  @ApiResponseArrayDecorator(CampaignDao)
  listCampaigns(
    @Query() query: ListCampaignsQueryDto,
  ): Promise<CampaignDao[] | Pagination<CampaignDao>> {
    if (query.page === undefined) {
      return this.campaignService.findAllCampaigns();
    }
    return this.campaignService.listCampaignsPaginated(query);
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
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:write', 'Sửa đợt chụp')
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
  @UseGuards(PermissionsGuard)
  @RequirePermission('campaign:delete', 'Xóa đợt chụp')
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

  /**
   * Zip export scoped to one campaign (Phase F.4,
   * docs/plans/card-photo-export-and-filters-plan-2026-09-17.md) — full
   * roster CSV (`campaign_subjects`, every row regardless of status),
   * approved-only photo-list CSV (`subject_photo_sets` where
   * `status = 'APPROVED'`), and one `${subjectCode}.jpg` per approved set.
   * Read-only, so left as `SsoAuthGuard`-only like every other GET route on
   * this controller (see this controller's own top doc comment on why
   * create/update/delete gained `PermissionsGuard` but reads did not).
   */
  @Get(':id/export-approved-photos')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({
    summary:
      'Download a zip: full roster CSV + approved-photos CSV + one {subjectCode}.jpg per approved set',
  })
  async exportApprovedPhotos(@Param('id') id: string): Promise<StreamableFile> {
    const { zip, filename } =
      await this.campaignService.exportApprovedPhotos(id);
    return new StreamableFile(zip, {
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
