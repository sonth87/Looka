import { toDao } from '@app/shared/http/to-dao.helper';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateIdentificationMethodDto,
  ListIdentificationMethodsQueryDto,
  UpdateIdentificationMethodDto,
} from '../dto';
import { IdentificationMethodDao } from '../dao';
import { IdentificationMethod } from '../entities/identification-method.entity';

/**
 * Catalog CRUD for `identification_methods` (plan §2.2/E1) — read-only
 * through P3 ("no CMS write flow was asked for in P3's scope", see the
 * entity's own doc comment); write routes added here once asked for.
 * `code` is immutable (see `UpdateIdentificationMethodDto`'s own comment);
 * retiring a method is `PATCH {active: false}`, not a hard `DELETE` — the
 * `active` column already exists for exactly this, and `sessions.
 * identification_method` has no FK to this table (E1: a catalog table, not
 * an enum, specifically so old data referencing a retired code never
 * breaks).
 */
@Injectable()
export class IdentificationMethodService extends CommonService<IdentificationMethod> {
  constructor(
    @InjectRepository(IdentificationMethod)
    repository: Repository<IdentificationMethod>,
  ) {
    super(repository);
  }

  async listActive(): Promise<IdentificationMethodDao[]> {
    const rows = await this.findAll({
      where: { active: true },
      order: { sortOrder: 'ASC' },
    });
    return toDao(IdentificationMethodDao, rows);
  }

  /** Includes inactive rows — the CMS management screen needs to see (and re-activate) retired methods, the kiosk-facing `GET` (no `includeInactive`) does not. */
  async listAll(): Promise<IdentificationMethodDao[]> {
    const rows = await this.findAll({ order: { sortOrder: 'ASC' } });
    return toDao(IdentificationMethodDao, rows);
  }

  /** Paginated variant, opt-in via `page` — see `ListIdentificationMethodsQueryDto`'s own doc comment. */
  async listPaginated(
    query: ListIdentificationMethodsQueryDto,
  ): Promise<Pagination<IdentificationMethodDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repository.createQueryBuilder('m');
    if (!query.includeInactive) {
      qb.andWhere('m.active = true');
    }
    if (query.q) {
      qb.andWhere('(m.name_vi ILIKE :q OR m.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    qb.orderBy('m.sort_order', 'ASC');

    const result = await this.paginateQueryBuilder(qb, { page, limit });
    return new Pagination(
      toDao(IdentificationMethodDao, result.items),
      result.meta,
    );
  }

  private async loadOrFail(id: string): Promise<IdentificationMethod> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row)
      throw new NotFoundException('Không tìm thấy phương thức định danh');
    return row;
  }

  async createMethod(
    dto: CreateIdentificationMethodDto,
  ): Promise<IdentificationMethodDao> {
    const existing = await this.repository.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Mã phương thức định danh đã tồn tại');
    }
    const created = await this.create({
      code: dto.code,
      nameVi: dto.nameVi,
      description: dto.description ?? null,
      requiresHardware: dto.requiresHardware ?? false,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return toDao(IdentificationMethodDao, created);
  }

  async updateMethod(
    id: string,
    dto: UpdateIdentificationMethodDto,
  ): Promise<IdentificationMethodDao> {
    const row = await this.loadOrFail(id);
    if (dto.nameVi !== undefined) row.nameVi = dto.nameVi;
    if (dto.description !== undefined) row.description = dto.description;
    if (dto.requiresHardware !== undefined)
      row.requiresHardware = dto.requiresHardware;
    if (dto.active !== undefined) row.active = dto.active;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    await this.save(row);
    return toDao(IdentificationMethodDao, row);
  }
}
