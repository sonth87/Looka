import { ApiResponseDecorator } from '@app/common/decorators';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { AddDevicePhotoDto, AddDeviceVideoDto } from '@app/modules/capture/dto';
import { PhotoService } from '@app/modules/capture/services/photo.service';
import { SessionVideoService } from '@app/modules/capture/services/session-video.service';
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
    private readonly photoService: PhotoService,
    private readonly sessionVideoService: SessionVideoService,
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

  /**
   * A kiosk pushing one captured photo's actual bytes (Part A, "route
   * kiosk photo uploads through apps/api instead of straight to the
   * file-service") — writes into the same `photos`/`upload_outbox` tables
   * `PhotoService.addPhoto` (the web path) already does, through the same
   * already-working `UploadWorkerService` cron, so a kiosk-sourced photo is
   * viewable from this API's own Postgres the instant it is captured,
   * never only after fs-core has it. See `PhotoService.addDevicePhoto`'s
   * own doc comment for the exact write shape and why `photoId`/`sessionId`
   * are supplied by the kiosk rather than generated here.
   *
   * Same nullable-campaignId guard as `getMyConfig`/`pushEvents` above — a
   * self-enrolled device with no campaign of its own has nothing this
   * write could attribute the photo to.
   */
  @Post('photos')
  @ApiOperation({
    summary: "Push one captured photo's actual bytes for durable storage ahead of the file-service",
  })
  async pushPhoto(
    @Req() req: Request,
    @Body() dto: AddDevicePhotoDto,
  ): Promise<{ photoId: string }> {
    if (!req.device!.campaignId) {
      throw new CustomException(
        'This device has no campaign (self-enrolled) — photo upload requires a campaign',
        ERROR_CODE.DEVICE_HAS_NO_CAMPAIGN,
        HttpStatus.CONFLICT,
      );
    }
    return this.photoService.addDevicePhoto(
      req.device!.id,
      req.device!.campaignId,
      dto,
    );
  }

  /**
   * A kiosk pushing one recorded video's actual bytes (2026-09-09, "route
   * kiosk VIDEO uploads through apps/api the same way kiosk PHOTO uploads
   * already work") — writes into the same `session_videos`/
   * `video_upload_outbox` tables `SessionVideoService.addDeviceVideo`'s own
   * doc comment describes, through the new `VideoUploadWorkerService` cron,
   * so a kiosk-sourced video is durable and viewable from this API's own
   * Postgres the instant it is captured, exactly like a photo already is.
   *
   * Same nullable-campaignId guard as `pushPhoto`/`getMyConfig`/`pushEvents`
   * above — a self-enrolled device with no campaign of its own has nothing
   * this write could attribute the video to.
   */
  @Post('videos')
  @ApiOperation({
    summary: "Push one recorded video's actual bytes for durable storage ahead of the file-service",
  })
  async pushVideo(
    @Req() req: Request,
    @Body() dto: AddDeviceVideoDto,
  ): Promise<{ videoId: string }> {
    if (!req.device!.campaignId) {
      throw new CustomException(
        'This device has no campaign (self-enrolled) — video upload requires a campaign',
        ERROR_CODE.DEVICE_HAS_NO_CAMPAIGN,
        HttpStatus.CONFLICT,
      );
    }
    return this.sessionVideoService.addDeviceVideo(
      req.device!.id,
      req.device!.campaignId,
      dto,
    );
  }
}
