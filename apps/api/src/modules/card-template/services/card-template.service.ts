import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  ALLOWED_DPI,
  DEFAULT_CARD_HEIGHT_MM,
  DEFAULT_CARD_WIDTH_MM,
  DEFAULT_DPI,
} from '../card-template.constants';
import type {
  CreateCardTemplateDto,
  ListCardTemplatesQueryDto,
  UpdateCardTemplateDto,
} from '../dto';
import { CardTemplateDetailDao, CardTemplateListItemDao } from '../dao';
import { CardTemplateAsset } from '../entities/card-template-asset.entity';
import { CardTemplate } from '../entities/card-template.entity';
import {
  DEFAULT_CARD_TEMPLATE_SIDE,
  validateCardTemplateSide,
  type CardTemplateSide,
} from '../schema/card-template-layout.schema';

/**
 * CRUD + lifecycle for `card_templates` (plan §2.6/P5). Plain
 * controller→service→entity style — matches the majority convention
 * (`device-management`/`photo-review`/`stats`), not the DDD-lite layout
 * `identity`/`workflow` use: a card template has no invariant complex
 * enough to warrant an aggregate (its one real rule — the version-bump on
 * PATCH below — is a single `if`).
 */
@Injectable()
export class CardTemplateService {
  constructor(
    @InjectRepository(CardTemplate)
    private readonly templates: Repository<CardTemplate>,
    @InjectRepository(CardTemplateAsset)
    private readonly assets: Repository<CardTemplateAsset>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {}

  async list(
    query: ListCardTemplatesQueryDto,
  ): Promise<Pagination<CardTemplateListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.templates.createQueryBuilder('t');
    if (query.status)
      qb.andWhere('t.status = :status', { status: query.status });
    if (query.q) {
      qb.andWhere('(t.name ILIKE :q OR t.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    qb.orderBy('t.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    const usageCounts = await this.usageCountsFor(rows.map((row) => row.id));
    return new Pagination(
      rows.map((row) =>
        CardTemplateListItemDao.from(row, usageCounts.get(row.id) ?? 0),
      ),
      {
        itemCount: rows.length,
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
      },
    );
  }

  /**
   * `COUNT(*) FROM print_items WHERE template_id = ... AND status NOT IN
   * ('CANCELLED', 'FAILED')` per template, batched into ONE query for a
   * whole list page rather than N — plan §2.6's `usageCount` definition,
   * now real as of P6 (`print_items` exists). Raw SQL against the table
   * name, no entity import — this module must not take a structural
   * dependency on `modules/print` any more than `modules/print` takes one
   * on this module's entities (see `modules/print`'s migration doc comment
   * for the same rule from the other side). An abandoned/failed print item
   * never counts as "used" — the same exclusion the plan's own PATCH rule
   * ("ACTIVE đã dùng → tự tăng version") implies: a template nobody
   * successfully queued a card against yet is still effectively unused.
   */
  private async usageCountsFor(
    templateIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (templateIds.length === 0) return counts;
    const rows: Array<{ template_id: string; count: string }> =
      await this.dataSource.query(
        `SELECT template_id, COUNT(*) AS count
         FROM print_items
        WHERE template_id = ANY($1) AND status NOT IN ('CANCELLED', 'FAILED')
        GROUP BY template_id`,
        [templateIds],
      );
    for (const row of rows) counts.set(row.template_id, Number(row.count));
    return counts;
  }

  private async usageCountFor(templateId: string): Promise<number> {
    return (await this.usageCountsFor([templateId])).get(templateId) ?? 0;
  }

  private async loadOrFail(id: string): Promise<CardTemplate> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException('Không tìm thấy phôi in');
    }
    return template;
  }

  async getDetail(id: string): Promise<CardTemplateDetailDao> {
    const template = await this.loadOrFail(id);
    const assets = await this.assets.find({
      where: { templateId: id },
      order: { createdAt: 'ASC' },
    });
    return CardTemplateDetailDao.fromDetail(
      template,
      assets,
      await this.usageCountFor(id),
    );
  }

  private validateSide(
    input: unknown,
    label: 'front' | 'back',
  ): CardTemplateSide {
    try {
      return validateCardTemplateSide(input);
    } catch (error) {
      throw new BadRequestException(
        `Bố cục ${label} không hợp lệ: ${(error as Error).message}`,
      );
    }
  }

  async create(
    dto: CreateCardTemplateDto,
    userId: string | null,
  ): Promise<CardTemplateDetailDao> {
    const existing = await this.templates.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Mã phôi đã tồn tại');
    }
    const dpi = dto.dpi ?? DEFAULT_DPI;
    if (!ALLOWED_DPI.includes(dpi)) {
      throw new BadRequestException('DPI chỉ hỗ trợ 300 hoặc 600');
    }

    const template = this.templates.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      status: 'DRAFT',
      version: 1,
      cardWidthMm: dto.cardSize?.widthMm ?? DEFAULT_CARD_WIDTH_MM,
      cardHeightMm: dto.cardSize?.heightMm ?? DEFAULT_CARD_HEIGHT_MM,
      dpi,
      front: dto.front
        ? this.validateSide(dto.front, 'front')
        : DEFAULT_CARD_TEMPLATE_SIDE,
      back: dto.back
        ? this.validateSide(dto.back, 'back')
        : DEFAULT_CARD_TEMPLATE_SIDE,
      createdByUserId: userId,
    });
    const saved = await this.templates.save(template);
    return CardTemplateDetailDao.fromDetail(saved, []);
  }

  /**
   * PATCH rule (plan §2.6): a DRAFT edits freely, in place. Once `ACTIVE`,
   * an edit still lands in place UNLESS the template already has usage
   * (`usageCount > 0`), in which case `version` increments — "tự tăng
   * version, không sửa đè" read as "bump the visible version counter",
   * not "fork a new row" (this table has no versions table to fork into,
   * unlike `workflows`/`workflow_versions` — see the migration's own doc
   * comment). `usageCount` is real as of P6 (`usageCountFor`, `print_items`
   * now exists) — this branch is live: editing an ACTIVE template already
   * used by at least one non-cancelled/failed print item now actually bumps
   * `version` instead of silently overwriting content a print run may
   * already reference. ARCHIVED templates cannot be edited at all (409).
   */
  async patch(
    id: string,
    dto: UpdateCardTemplateDto,
  ): Promise<CardTemplateDetailDao> {
    const template = await this.loadOrFail(id);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Phôi đã lưu trữ, không thể sửa');
    }

    if (dto.name !== undefined) template.name = dto.name;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.cardSize) {
      template.cardWidthMm = dto.cardSize.widthMm;
      template.cardHeightMm = dto.cardSize.heightMm;
    }
    if (dto.dpi !== undefined) {
      if (!ALLOWED_DPI.includes(dto.dpi)) {
        throw new BadRequestException('DPI chỉ hỗ trợ 300 hoặc 600');
      }
      template.dpi = dto.dpi;
    }
    if (dto.front !== undefined)
      template.front = this.validateSide(dto.front, 'front');
    if (dto.back !== undefined)
      template.back = this.validateSide(dto.back, 'back');

    if (template.status === 'ACTIVE' && (await this.usageCountFor(id)) > 0) {
      template.version += 1;
    }

    const saved = await this.templates.save(template);
    const assets = await this.assets.find({ where: { templateId: id } });
    return CardTemplateDetailDao.fromDetail(
      saved,
      assets,
      await this.usageCountFor(id),
    );
  }

  /** Copies `front`/`back` AND the source template's assets (new asset rows pointing at the same `fs_file_id` — no re-upload needed), rewriting `assetId` references inside the copied layout so the new template never depends on the old one's rows (which `DELETE` would cascade away). */
  async duplicate(id: string): Promise<CardTemplateDetailDao> {
    const source = await this.loadOrFail(id);
    const sourceAssets = await this.assets.find({ where: { templateId: id } });

    let code = `${source.code}-COPY`;
    let suffix = 1;

    while (await this.templates.findOne({ where: { code } })) {
      suffix += 1;
      code = `${source.code}-COPY${suffix}`;
    }

    return this.dataSource.transaction(async (manager) => {
      const newTemplate = manager.create(CardTemplate, {
        code,
        name: `${source.name} (bản sao)`,
        description: source.description,
        status: 'DRAFT',
        version: 1,
        cardWidthMm: source.cardWidthMm,
        cardHeightMm: source.cardHeightMm,
        dpi: source.dpi,
        front: source.front,
        back: source.back,
        createdByUserId: source.createdByUserId,
      });
      const saved = await manager.save(newTemplate);

      const assetIdMap = new Map<string, string>();
      const newAssets: CardTemplateAsset[] = [];
      for (const asset of sourceAssets) {
        const newAsset = manager.create(CardTemplateAsset, {
          templateId: saved.id,
          kind: asset.kind,
          fsFileId: asset.fsFileId,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        });

        const savedAsset = await manager.save(newAsset);
        assetIdMap.set(asset.id, savedAsset.id);
        newAssets.push(savedAsset);
      }

      saved.front = this.remapAssetIds(saved.front, assetIdMap);
      saved.back = this.remapAssetIds(saved.back, assetIdMap);
      const finalTemplate = await manager.save(saved);

      return CardTemplateDetailDao.fromDetail(finalTemplate, newAssets);
    });
  }

  private remapAssetIds(
    side: CardTemplateSide,
    assetIdMap: Map<string, string>,
  ): CardTemplateSide {
    return {
      background: {
        ...side.background,
        assetId:
          side.background.assetId && assetIdMap.has(side.background.assetId)
            ? (assetIdMap.get(side.background.assetId) ?? null)
            : side.background.assetId,
      },
      elements: side.elements.map((element) =>
        element.type === 'IMAGE' && assetIdMap.has(element.assetId)
          ? { ...element, assetId: assetIdMap.get(element.assetId) as string }
          : element,
      ),
    };
  }

  async publish(id: string): Promise<CardTemplateDetailDao> {
    const template = await this.loadOrFail(id);
    if (template.status !== 'DRAFT') {
      throw new ConflictException(
        'Chỉ phôi ở trạng thái nháp mới publish được',
      );
    }
    template.status = 'ACTIVE';
    template.publishedAt = new Date();
    const saved = await this.templates.save(template);
    const assets = await this.assets.find({ where: { templateId: id } });
    return CardTemplateDetailDao.fromDetail(
      saved,
      assets,
      await this.usageCountFor(id),
    );
  }

  async archive(id: string): Promise<CardTemplateDetailDao> {
    const template = await this.loadOrFail(id);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Phôi đã lưu trữ rồi');
    }
    template.status = 'ARCHIVED';
    template.archivedAt = new Date();
    const saved = await this.templates.save(template);
    const assets = await this.assets.find({ where: { templateId: id } });
    return CardTemplateDetailDao.fromDetail(
      saved,
      assets,
      await this.usageCountFor(id),
    );
  }

  /** Only a DRAFT with zero usage may be hard-deleted (plan §2.6) — cascades to `card_template_assets` at the DB level, and best-effort removes each asset's file-service copy first (same "best-effort, caller doesn't need it to block" pattern `SessionService`'s own supersede-cleanup uses). `usageCount` is real as of P6 — this guard is now actually reachable (a DRAFT template can accumulate print items via a per-item `templateId` override even before the template itself is ever published). */
  async delete(id: string): Promise<void> {
    const template = await this.loadOrFail(id);
    if (template.status !== 'DRAFT') {
      throw new ConflictException('Chỉ được xóa phôi ở trạng thái nháp');
    }
    if ((await this.usageCountFor(id)) > 0) {
      throw new ConflictException('Phôi đã được dùng để in, không thể xóa');
    }

    const assets = await this.assets.find({ where: { templateId: id } });
    for (const asset of assets) {
      await this.fileStorage.deleteFile(asset.fsFileId).catch(() => undefined);
    }
    await this.templates.remove(template);
  }

  /** Internal helper for `CardTemplateAssetService`/`CardTemplateRenderService` — same "load or 404" without re-exporting the repository itself. */
  async loadTemplateOrFail(id: string): Promise<CardTemplate> {
    return this.loadOrFail(id);
  }

  generateAssetIdempotencyKey(): string {
    return randomUUID();
  }
}
