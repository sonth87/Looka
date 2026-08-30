import { ApiResponseArrayDecorator, ApiResponseDecorator } from '@app/common/decorators';
import { Controller, Get, Header, Param, Post, Body, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { DeviceDao } from '../dao';
import { CreateDeviceDto } from '../dto';
import { ActivationPackageService } from '../services/activation-package.service';
import { CampaignService } from '../services/campaign.service';
import { DeviceService } from '../services/device.service';

/**
 * Admin/CMS-facing routes only — protected by the shared `x-api-key`
 * (`ApiKeyMiddleware`), same as capture's SessionController/PhotoController.
 * The kiosk's own self-service config read lives in `DeviceSelfController`
 * instead, on a separate class specifically so it is never swept into this
 * one's `ApiKeyMiddleware.forRoutes()` registration in AppModule — a kiosk
 * authenticates with its device secret, never the admin key that manages
 * every campaign.
 */
@Controller({ version: '1' })
@ApiTags('device-management')
@ApiSecurity('apiKey')
export class DeviceController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly campaignService: CampaignService,
    private readonly activationPackageService: ActivationPackageService,
  ) {}

  /**
   * Registers a device under a campaign and returns the single downloadable
   * package for it in the same call — a zip containing the shared installer
   * (if `DESKTOP_INSTALLER_PATH` is configured) plus this device's own
   * `activation.json`. See docs/plans/multi-camera-device-management-discussion.md
   * §3.2. There is no separate "fetch the secret later" endpoint: the
   * plaintext secret exists only for the duration of this request.
   */
  @Post('campaigns/:campaignId/devices')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({ summary: 'Register a device under a campaign and download its activation package' })
  async registerDevice(
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateDeviceDto,
  ): Promise<StreamableFile> {
    const campaign = await this.campaignService.findCampaignEntityOrFail(campaignId);
    const { device, plainSecret } = await this.deviceService.registerDevice(campaignId, dto);
    const zip = await this.activationPackageService.buildActivationZip(device, campaign, plainSecret);

    return new StreamableFile(zip, {
      disposition: `attachment; filename="looka-kiosk-${device.id}.zip"`,
    });
  }

  @Get('campaigns/:campaignId/devices')
  @ApiOperation({ summary: 'List devices registered under a campaign' })
  @ApiResponseArrayDecorator(DeviceDao)
  listDevicesByCampaign(@Param('campaignId') campaignId: string): Promise<DeviceDao[]> {
    return this.deviceService.findAllByCampaign(campaignId);
  }

  @Get('devices/:id')
  @ApiOperation({ summary: 'Get one device' })
  @ApiResponseDecorator(DeviceDao)
  getDevice(@Param('id') id: string): Promise<DeviceDao> {
    return this.deviceService.findDeviceOrFail(id);
  }
}
