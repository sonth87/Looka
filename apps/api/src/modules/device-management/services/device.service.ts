import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceDao } from '../dao';
import { CreateDeviceDto } from '../dto';
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
   */
  async registerDevice(
    campaignId: string,
    dto: CreateDeviceDto,
  ): Promise<{ device: Device; plainSecret: string }> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const plainSecret = generateDeviceSecret();
    const device = await this.create({
      campaignId,
      name: dto.name,
      authApiEndpoint: dto.authApiEndpoint,
      deviceSecretHash: hashDeviceSecret(plainSecret),
      status: DeviceStatus.REGISTERED,
    });

    return { device, plainSecret };
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
