import { toDao } from '@app/common/helpers';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignDao } from '../dao';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto';
import { Campaign, CampaignPurpose } from '../entities/campaign.entity';
import { validateCaptureAngles } from '../validation/capture-angles.validator';

@Injectable()
export class CampaignService extends CommonService<Campaign> {
  constructor(
    @InjectRepository(Campaign)
    repository: Repository<Campaign>,
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
}
