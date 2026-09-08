import { ApiResponseArrayDecorator, ApiResponseDecorator } from '@app/common/decorators';
import { SsoAuthGuard } from '@app/common/guards';
import { Controller, Get, Header, Param, Post, Body, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DeviceDao } from '../dao';
import { CreateDeviceDto, ReissueDeviceDto } from '../dto';
import { ActivationPackageService } from '../services/activation-package.service';
import { CampaignService } from '../services/campaign.service';
import { DeviceService } from '../services/device.service';

/**
 * Best-guess kiosk-facing API address, derived from the very request the
 * admin's own browser is already making — see `DeviceService.registerDevice`'s
 * doc comment for why this replaced asking the admin to type it into the
 * CMS form (2026-09-07). `req.get('host')` includes the port already, so
 * this needs no separate port config.
 */
function deriveApiBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Admin/CMS-facing routes only — protected by `SsoAuthGuard` (bearer token
 * forwarded to the external SSO backend, docs/LOGIN.md §12) as of
 * 2026-09-07, replacing the shared `x-api-key` it used to share with
 * capture's SessionController/PhotoController. The kiosk's own self-service
 * config read lives in `DeviceSelfController` instead, on a separate class
 * specifically so it is never swept into this one's guard/middleware
 * registration in AppModule — a kiosk authenticates with its device secret,
 * never the admin credential that manages every campaign.
 */
@Controller({ version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class DeviceController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly campaignService: CampaignService,
    private readonly activationPackageService: ActivationPackageService,
  ) {}

  /**
   * Registers a device under a campaign and returns the single downloadable
   * package for it in the same call — a zip containing the shared installer
   * for `dto.os` (mac/win, if the matching `DESKTOP_INSTALLER_PATH_MAC`/
   * `DESKTOP_INSTALLER_PATH_WIN` is configured) plus this device's own
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
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const campaign = await this.campaignService.findCampaignEntityOrFail(campaignId);
    const { device, plainSecret } = await this.deviceService.registerDevice(campaignId, dto, deriveApiBaseUrl(req));
    const zip = await this.activationPackageService.buildActivationZip(device, campaign, plainSecret, dto.os);

    return new StreamableFile(zip, {
      disposition: `attachment; filename="looka-kiosk-${device.id}.zip"`,
    });
  }

  /**
   * Rotates a device's secret WITH OVERLAP and hands back a fresh activation
   * zip — the only way to get a device a usable activation package again
   * once the original is gone (tab closed, download failed, etc.), since the
   * plaintext secret is never stored and so cannot simply be re-sent (see
   * `DeviceService.registerDevice`'s own doc comment). Same device row
   * throughout: id/name/history are untouched, only the secret (and,
   * optionally, `authApiEndpoint`) change. `dto.os`/`dto.authApiEndpoint` are
   * resuppliable in case the admin wants to correct either while reissuing —
   * an omitted `authApiEndpoint` keeps the device's current value, an
   * omitted `os` falls back to `buildActivationZip`'s own default (there is
   * no stored per-device `os`).
   *
   * Works for a device in ANY status, including already ACTIVATED — but,
   * as of 2026-09-08 (fixing the "kiosk 3" incident, see docs/ROADMAP.md's
   * dated entry), it no longer kills a kiosk already running on the old
   * secret: that secret stays valid, with no time limit, until the *new*
   * secret is used successfully once or the device is explicitly revoked
   * via `revokeDevice` below. Clicking "Tải gói kích hoạt" a second time for
   * an already-running kiosk — the exact incident this fixes — is now
   * harmless: the CMS just shows a "chưa nạp gói mới" chip. This is
   * precisely why the CMS no longer needs an operator confirmation before
   * calling this for an ACTIVATED device (that confirmation used to exist
   * because this call used to revoke on the spot).
   *
   * An already-ACTIVATED device's status is left as ACTIVATED across the
   * reissue (2026-09-07 — see `DeviceService.reissueDevice`'s own doc
   * comment) even though the *new* secret hasn't been confirmed by a kiosk
   * yet — a deliberate trade so "I just need the file again" doesn't read
   * as "starting over." A REVOKED device reissued this way returns to
   * REGISTERED — see `DeviceService.reissueDevice`'s own doc comment.
   */
  @Post('devices/:id/reissue')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({
    summary:
      "Reissue a device's activation package, rotating its secret with overlap (the old secret stays valid until the new one is used, or the device is revoked)",
  })
  async reissueDevice(
    @Param('id') id: string,
    @Body() dto: ReissueDeviceDto,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const { device, plainSecret } = await this.deviceService.reissueDevice(id, dto, deriveApiBaseUrl(req));
    const campaign = await this.campaignService.findCampaignEntityOrFail(device.campaignId);
    const zip = await this.activationPackageService.buildActivationZip(device, campaign, plainSecret, dto.os);

    return new StreamableFile(zip, {
      disposition: `attachment; filename="looka-kiosk-${device.id}.zip"`,
    });
  }

  /**
   * "Thu hồi" (revoke) — 2026-09-08, the explicit hard-stop action added
   * alongside the softer, overlapping `reissueDevice` above: invalidates
   * every secret this device has (current + previous) immediately, no
   * overlap, no grace period. Reissuing no longer revokes a running kiosk on
   * its own, so this is the only way to intentionally lock one out right
   * now (lost/stolen device, decommissioned kiosk) — see
   * `DeviceService.revokeDevice`'s own doc comment.
   */
  @Post('devices/:id/revoke')
  @ApiOperation({ summary: "Revoke a device's credentials immediately (no overlap)" })
  @ApiResponseDecorator(DeviceDao)
  revokeDevice(@Param('id') id: string): Promise<DeviceDao> {
    return this.deviceService.revokeDevice(id);
  }

  /**
   * Manually flips a device to ACTIVATED from the CMS — see
   * `DeviceService.activateDevice`'s own doc comment for why this exists
   * alongside the normal "first real kiosk call activates it" path. Never
   * touches the device secret, so it can't be used to grant access to a
   * device you don't already have the credentials for — this only changes
   * how the CMS displays a device that already has a valid activation zip
   * out there.
   */
  @Post('devices/:id/activate')
  @ApiOperation({ summary: 'Manually mark a device as ACTIVATED' })
  @ApiResponseDecorator(DeviceDao)
  activateDevice(@Param('id') id: string): Promise<DeviceDao> {
    return this.deviceService.activateDevice(id);
  }

  @Get('campaigns/:campaignId/devices')
  @ApiOperation({ summary: 'List devices registered under a campaign' })
  @ApiResponseArrayDecorator(DeviceDao)
  listDevicesByCampaign(@Param('campaignId') campaignId: string): Promise<DeviceDao[]> {
    return this.deviceService.findAllByCampaign(campaignId);
  }

  // A bare `:id` here would match the literal strings `config`/`events` too
  // — DeviceSelfController's own routes — and Express's router (and
  // ApiKeyMiddleware's own path matching, see app.module.ts's exclude() list)
  // both match on path shape, not which controller "should" own it. Rather
  // than a route-level regex constraint (path-to-regexp on the Express
  // version this app uses no longer supports inline `(pattern)` groups —
  // that was tried and threw at startup), the exclusion is declared once, at
  // the middleware, in app.module.ts.
  @Get('devices/:id')
  @ApiOperation({ summary: 'Get one device' })
  @ApiResponseDecorator(DeviceDao)
  getDevice(@Param('id') id: string): Promise<DeviceDao> {
    return this.deviceService.findDeviceOrFail(id);
  }
}
