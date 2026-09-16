import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaptureAnglePresetDao } from '../dao';
import {
  CreateCaptureAnglePresetDto,
  ListCaptureAnglePresetsQueryDto,
  UpdateCaptureAnglePresetDto,
} from '../dto';
import { CaptureAnglePreset } from '../entities/capture-angle-preset.entity';

/** Postgres unique_violation SQLSTATE — used to turn a raw duplicate-`code` insert into a clear 409. */
const UNIQUE_VIOLATION = '23505';

/**
 * The dynamic capture-angle catalog (§3.1.6) — CMS-managed, system-wide.
 * See `CaptureAnglePreset`'s own doc comment for the snapshot relationship
 * with a campaign's own `capture_angles[]`.
 */
@Injectable()
export class CaptureAnglePresetService extends CommonService<CaptureAnglePreset> {
  constructor(
    @InjectRepository(CaptureAnglePreset)
    repository: Repository<CaptureAnglePreset>,
  ) {
    super(repository);
  }

  /** `isSystem` is always false for an API-created preset — only the seed migration ever creates `isSystem: true` rows. */
  async createPreset(
    dto: CreateCaptureAnglePresetDto,
  ): Promise<CaptureAnglePresetDao> {
    let preset: CaptureAnglePreset;
    try {
      preset = await this.create({
        code: dto.code,
        labelVi: dto.labelVi,
        instructionVi: dto.instructionVi,
        poseDefault: dto.poseDefault,
        preferredCameraRole: dto.preferredCameraRole,
        isSystem: false,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
    } catch (error) {
      const dbError = error as { code?: string } | undefined;
      if (dbError?.code === UNIQUE_VIOLATION) {
        throw new CustomException(
          'Capture angle preset code already in use',
          ERROR_CODE.CAPTURE_ANGLE_PRESET_CODE_TAKEN,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    return toDao(CaptureAnglePresetDao, preset);
  }

  /** Active presets by default (the picker's normal case); pass `includeInactive: true` for the CMS's own "Góc chụp" management list. */
  async listPresets(
    includeInactive: boolean,
  ): Promise<CaptureAnglePresetDao[]> {
    const presets = await this.findAll({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return toDao(CaptureAnglePresetDao, presets);
  }

  /**
   * Paginated variant of `listPresets` — opt-in via `ListCaptureAnglePresetsQueryDto.page`,
   * same §9.1 rule-6 pattern as `CampaignService.listCampaignsPaginated`
   * (the CMS's "Góc chụp" management list; the unpaginated picker keeps
   * using `listPresets` above).
   */
  async listPresetsPaginated(
    query: ListCaptureAnglePresetsQueryDto,
  ): Promise<Pagination<CaptureAnglePresetDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repository.createQueryBuilder('p');
    if (!query.includeInactive) {
      qb.andWhere('p.active = true');
    }
    if (query.q) {
      qb.andWhere('(p.label_vi ILIKE :q OR p.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    qb.orderBy('p.sort_order', 'ASC').addOrderBy('p.created_at', 'ASC');

    const result = await this.paginateQueryBuilder(qb, { page, limit });
    return new Pagination(
      toDao(CaptureAnglePresetDao, result.items),
      result.meta,
    );
  }

  async findPresetEntityOrFail(id: string): Promise<CaptureAnglePreset> {
    const preset = await this.findById(id);
    if (!preset) {
      throw new CustomException(
        'Capture angle preset not found',
        ERROR_CODE.CAPTURE_ANGLE_PRESET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return preset;
  }

  /**
   * `code`/`isSystem` are never touched here — `UpdateCaptureAnglePresetDto`
   * simply has no field for either, so there is nothing to refuse at
   * runtime; a system preset's label/instruction/pose ARE editable like any
   * other row (task brief), and "delete" for any preset is `active: false`.
   */
  async updatePreset(
    id: string,
    dto: UpdateCaptureAnglePresetDto,
  ): Promise<CaptureAnglePresetDao> {
    const preset = await this.findPresetEntityOrFail(id);

    if (dto.labelVi !== undefined) preset.labelVi = dto.labelVi;
    if (dto.instructionVi !== undefined)
      preset.instructionVi = dto.instructionVi;
    if (dto.poseDefault !== undefined) {
      preset.poseDefault = dto.poseDefault;
    }
    if (dto.preferredCameraRole !== undefined)
      preset.preferredCameraRole = dto.preferredCameraRole;
    if (dto.active !== undefined) preset.active = dto.active;
    if (dto.sortOrder !== undefined) preset.sortOrder = dto.sortOrder;

    await this.save(preset);
    return toDao(CaptureAnglePresetDao, preset);
  }
}
