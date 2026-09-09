import { ApiResponseDecorator } from '@app/common/decorators';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignDao } from '../dao';
import { CreateDeviceEventsDto } from '../dto/create-device-events.dto';
import { DeviceCredentialsGuard } from '../guards/device-credentials.guard';
import { CampaignService } from '../services/campaign.service';
import { DeviceEventService } from '../services/device-event.service';

/**
 * A kiosk reading its own resources — never registered under
 * `ApiKeyMiddleware.forRoutes()` in AppModule, so it is not, and must never
 * become, reachable with the shared admin `x-api-key`. `DeviceCredentialsGuard`
 * is this controller's only gate, checking `x-device-id`/`x-device-secret`
 * instead — a kiosk has a device identity, not the key that manages every
 * campaign in the CMS.
 */
@Controller({ path: 'devices', version: '1' })
@ApiTags('device-management')
@UseGuards(DeviceCredentialsGuard)
export class DeviceSelfController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly deviceEventService: DeviceEventService,
  ) {}

  /**
   * Capture angles (§3.6), capture mode/autoHoldMs (§3.8), consent
   * text/version (§2.4) — everything a kiosk needs to configure itself for
   * a session. Identity comes entirely from the guard-checked headers, not a
   * URL param: a device only ever gets to read its own campaign, never one
   * it merely guesses the id of.
   */
  @Get('config')
  @ApiOperation({ summary: "Get the calling kiosk's own campaign config" })
  @ApiResponseDecorator(CampaignDao)
  async getMyConfig(@Req() req: Request): Promise<CampaignDao> {
    // 2026-09-08: campaignId is now nullable (self-enrolled devices, §3.3) —
    // this could not happen before that column allowed NULL. A self-enrolled
    // device has no campaign of its own; its config comes from
    // GET /v1/campaigns/:id/config (a user-token endpoint) instead, once the
    // logged-in user picks a campaign to capture for.
    if (!req.device!.campaignId) {
      throw new CustomException(
        'This device has no campaign (self-enrolled) — use GET /v1/campaigns/:id/config instead',
        ERROR_CODE.DEVICE_HAS_NO_CAMPAIGN,
        HttpStatus.CONFLICT,
      );
    }
    const campaign = await this.campaignService.findCampaignEntityOrFail(
      req.device!.campaignId,
    );
    return toDao(CampaignDao, campaign);
  }

  /**
   * A kiosk pushing whatever stats events it has queued locally — see
   * docs/plans/multi-camera-device-management-discussion.md §3.4. A batch,
   * not one event per call (see the DTO's own doc comment): a kiosk that was
   * offline for a while pushes everything it accumulated in one call once
   * it reconnects. `campaignId` is taken from the authenticated device, not
   * the request body — a kiosk can only ever log events under its own
   * campaign.
   */
  @Post('events')
  @HttpCode(202)
  @ApiOperation({ summary: "Push a batch of this kiosk's stats events" })
  async pushEvents(
    @Req() req: Request,
    @Body() dto: CreateDeviceEventsDto,
  ): Promise<{ accepted: number }> {
    // Same 2026-09-08 nullability note as getMyConfig above.
    if (!req.device!.campaignId) {
      throw new CustomException(
        'This device has no campaign (self-enrolled) — stats events require a campaign',
        ERROR_CODE.DEVICE_HAS_NO_CAMPAIGN,
        HttpStatus.CONFLICT,
      );
    }
    const accepted = await this.deviceEventService.recordBatch(
      req.device!.id,
      req.device!.campaignId,
      dto.events,
    );
    return { accepted };
  }
}
