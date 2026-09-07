import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceDao } from '../dao';
import { CreateDeviceDto, ReissueDeviceDto } from '../dto';
import { Device, DeviceStatus } from '../entities/device.entity';
import { generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret } from './device-secret.util';
import { CampaignService } from './campaign.service';

export type DeviceCredentialCheck =
  | { ok: true; device: Device }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_SECRET' | 'EXPIRED' };

@Injectable()
export class DeviceService extends CommonService<Device> {
  constructor(
    @InjectRepository(Device)
    repository: Repository<Device>,
    private readonly campaignService: CampaignService,
  ) {
    super(repository);
  }

  /**
   * Creates the device row and returns the plaintext secret exactly once —
   * only `ActivationPackageService` (called right after this, in the same
   * request) ever sees it. Nothing persists the plaintext; only its hash is
   * stored, so a lost activation zip cannot be recovered, only reissued via
   * a fresh registration.
   *
   * `requestApiBaseUrl` (2026-09-07): the admin no longer has to type the
   * kiosk-facing API address into the CMS form — the controller derives it
   * from the very request the admin's own browser is already making
   * (`req.protocol`/`req.get('host')`), and it's used here only when the
   * admin didn't explicitly override `dto.authApiEndpoint`. This is still
   * only a best guess (it reflects wherever the ADMIN'S browser reached the
   * API from, which is wrong if a kiosk is on a different network path —
   * e.g. the admin using `localhost` while the kiosk is a separate physical
   * machine), so `dto.authApiEndpoint` stays a real override for that case,
   * not a rubber-stamped field.
   */
  async registerDevice(
    campaignId: string,
    dto: CreateDeviceDto,
    // Defaults to '' for callers that don't care (existing tests) — the
    // controller always passes the real derived value; see this param's
    // own doc comment above.
    requestApiBaseUrl = '',
  ): Promise<{ device: Device; plainSecret: string }> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const plainSecret = generateDeviceSecret();
    const device = await this.create({
      campaignId,
      name: dto.name,
      authApiEndpoint: dto.authApiEndpoint?.trim() || requestApiBaseUrl,
      deviceSecretHash: hashDeviceSecret(plainSecret),
      status: DeviceStatus.REGISTERED,
    });

    return { device, plainSecret };
  }

  /**
   * Rotates an existing device's secret in place — same id/name/history,
   * only `deviceSecretHash` (and, optionally, `authApiEndpoint`) change. This
   * is the only way to get a device a usable activation package again once
   * the original zip is gone (tab closed, download failed, etc.), since the
   * plaintext secret is never persisted and therefore cannot simply be
   * re-sent — see this class's own doc comment on `registerDevice`.
   *
   * Called both for a still-REGISTERED device (the first zip was lost
   * before any kiosk ever used it) and for an already-ACTIVATED one
   * (revoking a running kiosk's credentials on purpose, or an admin just
   * wants a fresh copy of the zip) — see `DeviceController.reissueDevice`'s
   * own doc comment for why revoking a running kiosk is intended behavior,
   * not something to guard against here.
   *
   * `status`/`activatedAt` (2026-09-07, changed by product request — "chỉ
   * cần tải gói chứ không cần phải thiết lập lại kích hoạt"): only reset to
   * REGISTERED/`null` when the device was NOT already ACTIVATED — a device
   * that was already running is left showing ACTIVATED across the reissue,
   * even though strictly the *new* secret hasn't been confirmed by any
   * kiosk yet. That's a deliberate, acknowledged trade of strict accuracy
   * (the badge can lag reality until the new zip is actually loaded
   * somewhere) for not making a routine "just get me the file again" action
   * look like starting over from scratch. A device that was still
   * REGISTERED keeps resetting normally — there is no "was activated"
   * state to preserve for it. The manual `activateDevice` action remains
   * available if an admin wants to force ACTIVATED back on regardless.
   */
  async reissueDevice(
    id: string,
    dto: ReissueDeviceDto,
    requestApiBaseUrl = '',
  ): Promise<{ device: Device; plainSecret: string }> {
    const device = await this.findDeviceEntityOrFail(id);

    const plainSecret = generateDeviceSecret();
    device.deviceSecretHash = hashDeviceSecret(plainSecret);
    if (device.status !== DeviceStatus.ACTIVATED) {
      device.status = DeviceStatus.REGISTERED;
      device.activatedAt = null;
    }
    if (dto.authApiEndpoint !== undefined) {
      device.authApiEndpoint = dto.authApiEndpoint;
    } else if (!device.authApiEndpoint) {
      device.authApiEndpoint = requestApiBaseUrl;
    }
    await this.save(device);

    return { device, plainSecret };
  }

  /**
   * Manually marks a device ACTIVATED from the CMS (2026-09-07 product
   * request) — normally `verifyCredentials` below is the only thing that
   * flips this, the moment a real kiosk's first `GET /v1/devices/config`
   * succeeds. This exists for testing/ops purposes when an admin wants the
   * device to read as activated without waiting for (or without ever
   * having) a real kiosk call in. Deliberately does NOT touch
   * `deviceSecretHash` — unlike `reissueDevice`, this never invalidates
   * whatever credentials are already out there.
   */
  async activateDevice(id: string): Promise<DeviceDao> {
    const device = await this.findDeviceEntityOrFail(id);
    device.status = DeviceStatus.ACTIVATED;
    device.activatedAt = new Date();
    await this.save(device);
    return toDao(DeviceDao, device);
  }

  async findAllByCampaign(campaignId: string): Promise<DeviceDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const devices = await this.findAll({ where: { campaignId }, order: { createdAt: 'DESC' } });
    return toDao(DeviceDao, devices);
  }

  async findDeviceEntityOrFail(id: string): Promise<Device> {
    const device = await this.findOne({ where: { id }, relations: { campaign: true } });
    if (!device) {
      throw new CustomException('Device not found', ERROR_CODE.DEVICE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return device;
  }

  async findDeviceOrFail(id: string): Promise<DeviceDao> {
    return toDao(DeviceDao, await this.findDeviceEntityOrFail(id));
  }

  /**
   * The check every authenticated kiosk request ultimately reduces to (see
   * docs/plans/multi-camera-device-management-discussion.md §3.3): does
   * `deviceId`/`secret` resolve to a real, non-expired device? `deviceSecretHash`
   * has `select: false` on the entity, so it must be asked for explicitly here
   * — every other read path in this service never sees it.
   *
   * Expiry is checked on the device's *campaign*, never the device itself —
   * there is no `expires_at` column on `devices` (see the campaign-level
   * decision in §3.2). `NULL` there means the campaign is permanent.
   */
  async verifyCredentials(deviceId: string, secret: string): Promise<DeviceCredentialCheck> {
    const device = await this.repository.findOne({
      where: { id: deviceId },
      relations: { campaign: true },
      select: {
        id: true,
        campaignId: true,
        deviceSecretHash: true,
        status: true,
        campaign: { id: true, expiresAt: true },
      },
    });
    if (!device) return { ok: false, reason: 'NOT_FOUND' };

    if (!verifyDeviceSecret(secret, device.deviceSecretHash)) {
      return { ok: false, reason: 'INVALID_SECRET' };
    }

    const expiresAt = device.campaign?.expiresAt;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    // First successful call is what "activation" means — the kiosk has
    // proven it actually loaded the file, not just that CMS created a row.
    if (device.status === DeviceStatus.REGISTERED) {
      device.status = DeviceStatus.ACTIVATED;
      device.activatedAt = new Date();
      await this.save(device);
    }

    return { ok: true, device };
  }
}
