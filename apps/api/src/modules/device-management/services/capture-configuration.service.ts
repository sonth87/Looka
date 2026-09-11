import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaptureConfigurationDao } from '../dao';
import {
  CreateCaptureConfigurationDto,
  UpdateCaptureConfigurationDto,
} from '../dto';
import { CaptureConfiguration } from '../entities/capture-configuration.entity';
import {
  computeRequiredCameraCount,
  validateCaptureAngles,
} from '../validation/capture-angles.validator';

/**
 * "Capture Configuration" — item 10 of the 2026-09-09 task brief. A
 * reusable capture template an admin manages independently of any one
 * campaign; `CampaignForm.tsx`'s "Chọn từ cấu hình có sẵn" copies one of
 * these onto a campaign's own `captureAngles`/`cardSpec` fields at creation/
 * edit time. See `CaptureConfiguration`'s own doc comment for why this is
 * deliberately a one-time-copy preset, never a live link.
 *
 * A genuine CRUD resource (unlike `CaptureAnglePresetService`'s
 * `active`-flag "soft delete" catalog): deleting a configuration here only
 * removes the template itself, never touches any campaign that already
 * copied its values in.
 */
@Injectable()
export class CaptureConfigurationService extends CommonService<CaptureConfiguration> {
  constructor(
    @InjectRepository(CaptureConfiguration)
    repository: Repository<CaptureConfiguration>,
  ) {
    super(repository);
  }

  private toDaoWithRequiredCameraCount(
    entity: CaptureConfiguration,
  ): CaptureConfigurationDao {
    const dao = toDao(CaptureConfigurationDao, entity);
    dao.requiredCameraCount = computeRequiredCameraCount(entity.captureAngles);
    return dao;
  }

  async listCaptureConfigurations(): Promise<CaptureConfigurationDao[]> {
    const configs = await this.findAll({ order: { createdAt: 'DESC' } });
    return configs.map((c) => this.toDaoWithRequiredCameraCount(c));
  }

  async findCaptureConfigEntityOrFail(
    id: string,
  ): Promise<CaptureConfiguration> {
    const config = await this.findById(id);
    if (!config) {
      throw new CustomException(
        'Capture configuration not found',
        ERROR_CODE.CAPTURE_CONFIGURATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return config;
  }

  async findCaptureConfigOrFail(id: string): Promise<CaptureConfigurationDao> {
    const config = await this.findCaptureConfigEntityOrFail(id);
    return this.toDaoWithRequiredCameraCount(config);
  }

  async createCaptureConfiguration(
    dto: CreateCaptureConfigurationDto,
  ): Promise<CaptureConfigurationDao> {
    const check = validateCaptureAngles(dto.captureAngles);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const config = await this.create({
      name: dto.name,
      description: dto.description ?? null,
      captureAngles: dto.captureAngles as unknown as CaptureConfiguration['captureAngles'],
      cardSpec: dto.cardSpec ?? null,
    });

    return this.toDaoWithRequiredCameraCount(config);
  }

  async updateCaptureConfiguration(
    id: string,
    dto: UpdateCaptureConfigurationDto,
  ): Promise<CaptureConfigurationDao> {
    const config = await this.findCaptureConfigEntityOrFail(id);

    const mergedCaptureAngles =
      dto.captureAngles !== undefined ? dto.captureAngles : config.captureAngles;
    const check = validateCaptureAngles(mergedCaptureAngles);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    if (dto.name !== undefined) config.name = dto.name;
    if (dto.description !== undefined) config.description = dto.description;
    if (dto.captureAngles !== undefined) {
      config.captureAngles =
        dto.captureAngles as unknown as CaptureConfiguration['captureAngles'];
    }
    if (dto.cardSpec !== undefined) config.cardSpec = dto.cardSpec;

    await this.save(config);
    return this.toDaoWithRequiredCameraCount(config);
  }

  /**
   * Hard delete — this table has no notion of "in use" to protect (see the
   * class doc comment: a campaign that picked this configuration already
   * copied its values in and is entirely unaffected by this row going
   * away), unlike `CaptureAnglePreset`'s `active`-flag soft delete, which
   * exists because a preset's `code` is a stable link other data displays
   * against.
   */
  async deleteCaptureConfiguration(id: string): Promise<void> {
    await this.findCaptureConfigEntityOrFail(id);
    await this.delete(id);
  }
}
