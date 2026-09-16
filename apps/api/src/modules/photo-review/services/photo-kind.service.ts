import { CustomException } from '@app/shared/errors/legacy';
import { toDao } from '@app/shared/http/to-dao.helper';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhotoKindDao } from '../dao';
import {
  CreatePhotoKindDto,
  ListPhotoKindsQueryDto,
  UpdatePhotoKindDto,
} from '../dto';
import { PhotoKind } from '../entities/photo-kind.entity';
import { PHOTO_REVIEW_ERROR_CODE } from '../photo-review.constants';

/** Postgres unique_violation SQLSTATE — same convention as `CampaignService.mapCodeUniqueViolation`. */
const UNIQUE_VIOLATION = '23505';

/** `photo_kinds` CRUD (plan §5.6/yêu cầu 7) — configuration, not a review action, hence gated by admin-only in the controller rather than `ReviewerRoleGuard`. */
@Injectable()
export class PhotoKindService extends CommonService<PhotoKind> {
  constructor(
    @InjectRepository(PhotoKind)
    repository: Repository<PhotoKind>,
  ) {
    super(repository);
  }

  async listKinds(): Promise<PhotoKindDao[]> {
    const kinds = await this.findAll({ order: { createdAt: 'ASC' } });
    return toDao(PhotoKindDao, kinds);
  }

  /** Paginated variant, opt-in via `page` — see `ListPhotoKindsQueryDto`'s own doc comment. */
  async listKindsPaginated(
    query: ListPhotoKindsQueryDto,
  ): Promise<Pagination<PhotoKindDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repository.createQueryBuilder('k');
    if (query.active !== undefined) {
      qb.andWhere('k.active = :active', { active: query.active });
    }
    if (query.q) {
      qb.andWhere('(k.label_vi ILIKE :q OR k.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    qb.orderBy('k.created_at', 'ASC');

    const result = await this.paginateQueryBuilder(qb, { page, limit });
    return new Pagination(toDao(PhotoKindDao, result.items), result.meta);
  }

  async findKindEntityOrFail(id: string): Promise<PhotoKind> {
    const kind = await this.findById(id);
    if (!kind) {
      throw new CustomException(
        'Photo kind not found',
        PHOTO_REVIEW_ERROR_CODE.PHOTO_KIND_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return kind;
  }

  async findKindOrFail(id: string): Promise<PhotoKindDao> {
    return toDao(PhotoKindDao, await this.findKindEntityOrFail(id));
  }

  async createKind(dto: CreatePhotoKindDto): Promise<PhotoKindDao> {
    let kind: PhotoKind;
    try {
      kind = await this.create({
        code: dto.code,
        labelVi: dto.labelVi,
        cardSpec: dto.cardSpec,
        qualityProfile: dto.qualityProfile ?? null,
        promptHints: dto.promptHints ?? [],
        active: dto.active ?? true,
      });
    } catch (error) {
      throw this.mapCodeUniqueViolation(error);
    }
    return toDao(PhotoKindDao, kind);
  }

  async updateKind(id: string, dto: UpdatePhotoKindDto): Promise<PhotoKindDao> {
    const kind = await this.findKindEntityOrFail(id);

    if (dto.labelVi !== undefined) kind.labelVi = dto.labelVi;
    if (dto.cardSpec !== undefined) kind.cardSpec = dto.cardSpec;
    if (dto.qualityProfile !== undefined)
      kind.qualityProfile = dto.qualityProfile;
    if (dto.promptHints !== undefined) kind.promptHints = dto.promptHints;
    if (dto.active !== undefined) kind.active = dto.active;

    await this.save(kind);
    return toDao(PhotoKindDao, kind);
  }

  private mapCodeUniqueViolation(error: unknown): unknown {
    const dbError = error as { code?: string } | undefined;
    if (dbError?.code === UNIQUE_VIOLATION) {
      return new CustomException(
        'Photo kind code already in use',
        PHOTO_REVIEW_ERROR_CODE.PHOTO_KIND_CODE_TAKEN,
        HttpStatus.CONFLICT,
      );
    }
    return error;
  }
}
