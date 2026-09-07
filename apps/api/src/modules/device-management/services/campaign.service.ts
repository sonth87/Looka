import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { SessionService } from '@app/modules/capture/services/session.service';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignDao } from '../dao';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto';
import { Campaign, CampaignPurpose } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';
import { validateCaptureAngles } from '../validation/capture-angles.validator';

@Injectable()
export class CampaignService extends CommonService<Campaign> {
  constructor(
    @InjectRepository(Campaign)
    repository: Repository<Campaign>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    private readonly sessionService: SessionService,
  ) {
    super(repository);
  }

  async createCampaign(dto: CreateCampaignDto): Promise<CampaignDao> {
    const simultaneousCapture = dto.simultaneousCapture ?? false;
    const captureAnglesCheck = validateCaptureAngles(dto.captureAngles, simultaneousCapture);
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
    }

    const campaign = await this.create({
      name: dto.name,
      description: dto.description,
      purpose: dto.purpose ?? CampaignPurpose.STUDENT_CARD,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      // A campaign created with consent text already set starts at version 1,
      // not 0 — 0 is reserved for "never configured, using the built-in
      // generic default" (see the entity's own doc comment).
      consentContent: dto.consentContent ?? null,
      consentVersion: dto.consentContent ? 1 : 0,
      captureAngles: (dto.captureAngles as unknown as Campaign['captureAngles']) ?? null,
      captureMode: dto.captureMode ?? null,
      autoHoldMs: dto.autoHoldMs ?? null,
      simultaneousCapture,
      recordVideo: dto.recordVideo ?? false,
    });

    return toDao(CampaignDao, campaign);
  }

  async findAllCampaigns(): Promise<CampaignDao[]> {
    const campaigns = await this.findAll({ order: { createdAt: 'DESC' } });
    return toDao(CampaignDao, campaigns);
  }

  async findCampaignEntityOrFail(id: string): Promise<Campaign> {
    const campaign = await this.findById(id);
    if (!campaign) {
      throw new CustomException(
        'Campaign not found',
        ERROR_CODE.CAMPAIGN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return campaign;
  }

  async findCampaignOrFail(id: string): Promise<CampaignDao> {
    return toDao(CampaignDao, await this.findCampaignEntityOrFail(id));
  }

  /**
   * Extend/renew, edit consent, or change capture config — all campaign-level
   * settings, so this affects every device registered under the campaign at
   * once (see docs/plans/multi-camera-device-management-discussion.md §3.2's
   * "gia hạn 1 campaign tự động gia hạn mọi thiết bị" decision — there is
   * nothing to update per-device, since none of these fields live there).
   */
  async updateCampaign(id: string, dto: UpdateCampaignDto): Promise<CampaignDao> {
    const campaign = await this.findCampaignEntityOrFail(id);

    // Validate the *merged* state - a new captureAngles against the existing
    // flag, the existing angles against a newly-flipped flag, or both new -
    // so toggling simultaneousCapture on a campaign whose already-saved
    // angles collide is rejected too, not just a request that changes both
    // fields at once.
    const mergedSimultaneousCapture = dto.simultaneousCapture ?? campaign.simultaneousCapture;
    const mergedCaptureAngles =
      dto.captureAngles !== undefined ? dto.captureAngles : campaign.captureAngles;
    const captureAnglesCheck = validateCaptureAngles(
      mergedCaptureAngles,
      mergedSimultaneousCapture,
    );
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
    }

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.description !== undefined) campaign.description = dto.description;
    if (dto.expiresAt !== undefined) {
      campaign.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }
    if (dto.captureAngles !== undefined) {
      campaign.captureAngles = dto.captureAngles as unknown as Campaign['captureAngles'];
    }
    if (dto.captureMode !== undefined) campaign.captureMode = dto.captureMode;
    if (dto.autoHoldMs !== undefined) campaign.autoHoldMs = dto.autoHoldMs;
    if (dto.simultaneousCapture !== undefined) {
      campaign.simultaneousCapture = dto.simultaneousCapture;
    }
    if (dto.recordVideo !== undefined) {
      campaign.recordVideo = dto.recordVideo;
    }

    // Bump only on an actual change — a no-op PATCH (or one that only
    // touches other fields) must not invalidate every device's already-shown
    // consent version for nothing.
    if (dto.consentContent !== undefined && dto.consentContent !== campaign.consentContent) {
      campaign.consentContent = dto.consentContent;
      campaign.consentVersion += 1;
    }

    await this.save(campaign);
    return toDao(CampaignDao, campaign);
  }

  /**
   * Hard-deletes a campaign row — refused with a 409 when the campaign
   * still has devices or capture sessions attached (see docs/ROADMAP.md's
   * 2026-09-07 entry for the full write-up):
   *
   * - `devices.campaign_id` is `ON DELETE CASCADE` (device.entity.ts) — an
   *   unguarded delete would silently hard-delete every real kiosk
   *   registration under this campaign (device_secret_hash included), not
   *   just detach them. That is real, unrecoverable operational data, not
   *   an incidental row.
   * - `sessions.campaign_id`/`device_id` are `ON DELETE SET NULL`
   *   (migration `CaptureRecords1787900000000`) — capture history survives
   *   a delete, but becomes permanently unattributable to any campaign,
   *   which is still a surprising silent side effect for an admin who only
   *   meant to remove an unused campaign row.
   *
   * Both are surprising enough to refuse rather than cascade through: an
   * admin must remove every device under a campaign (there is currently no
   * device-delete endpoint, so in practice this only ever succeeds for a
   * campaign that was created but never used to register a kiosk) before
   * the campaign itself can be deleted.
   */
  async deleteCampaign(id: string): Promise<void> {
    await this.findCampaignEntityOrFail(id);

    const [deviceCount, sessionCount] = await Promise.all([
      this.deviceRepository.count({ where: { campaignId: id } }),
      this.sessionService.countByCampaign(id),
    ]);

    if (deviceCount > 0 || sessionCount > 0) {
      throw new CustomException(
        `Cannot delete campaign: it still has ${deviceCount} device(s) and ${sessionCount} session(s) attached. Remove its devices first.`,
        ERROR_CODE.CAMPAIGN_HAS_DEPENDENCIES,
        HttpStatus.CONFLICT,
      );
    }

    await this.delete(id);
  }
}
