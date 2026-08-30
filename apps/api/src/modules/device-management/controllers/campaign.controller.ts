import { ApiResponseArrayDecorator, ApiResponseDecorator } from '@app/common/decorators';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CampaignDao, CampaignStatsDao } from '../dao';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto';
import { CampaignService } from '../services/campaign.service';
import { DeviceEventService } from '../services/device-event.service';

@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@ApiSecurity('apiKey')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly deviceEventService: DeviceEventService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a campaign — a named group of devices sharing one expiry/consent/capture config' })
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
  @ApiOperation({ summary: 'Update a campaign (expiry, consent, capture config)' })
  @ApiResponseDecorator(CampaignDao)
  updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignDao> {
    return this.campaignService.updateCampaign(id, dto);
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
