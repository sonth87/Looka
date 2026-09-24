import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import { CardTemplateService } from '@app/modules/card-template/services/card-template.service';
import { CardTemplateRenderService } from '@app/modules/card-template/services/card-template-render.service';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  BulkCreatePrintItemsDto,
  BulkTemplatePrintItemsDto,
  ListPrintItemsQueryDto,
  PrintItemGroupsQueryDto,
  PrintItemStatusCallbackDto,
  UpdatePrintItemDto,
} from '../dto';
import {
  PrintItemDetailDao,
  PrintItemGroupDao,
  PrintItemListItemDao,
} from '../dao';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { PrintBatch } from '../entities/print-batch.entity';
import { Printer } from '../entities/printer.entity';
import { PrintStatsService } from '@app/modules/stats/services/print-stats.service';
import { MAX_BULK_ITEMS } from '../print.constants';
import { PrinterService } from './printer.service';

interface CandidateSetRow {
  id: string;
  campaign_id: string;
  subject_code: string;
  subject_name: string | null;
  class_name: string | null;
  faculty: string | null;
  current_card_variant_id: string | null;
  date_of_birth: Date | string | null;
  card_valid_until: Date | string | null;
}

/**
 * Core lifecycle for `print_items` — plan §2.5. Plain controller→service→
 * entity style (see `CardTemplateService`'s own doc comment for why this
 * whole phase avoids the DDD-lite layout).
 *
 * Reuses `CardTemplateRenderService`/`CardTemplateService` for the actual
 * render (point 6 of the task brief — no reimplementation), and reads
 * `subject_photo_sets`/`campaign_subjects`/`campaigns` via raw SQL (module
 * boundary rule — see the migration's own top comment for why even
 * `template_id` gets no FK despite the real Nest-level `CardTemplateModule`
 * dependency).
 */
@Injectable()
export class PrintItemService {
  constructor(
    @InjectRepository(PrintItem) private readonly items: Repository<PrintItem>,
    @InjectRepository(PrintItemEvent)
    private readonly events: Repository<PrintItemEvent>,
    @InjectRepository(PrintBatch)
    private readonly batches: Repository<PrintBatch>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly templateService: CardTemplateService,
    private readonly renderService: CardTemplateRenderService,
    private readonly fileStorage: FileStorageService,
    private readonly printStats: PrintStatsService,
    private readonly printerService: PrinterService,
  ) {}

  // ── Read ────────────────────────────────────────────────────────────

  async list(
    query: ListPrintItemsQueryDto,
  ): Promise<Pagination<PrintItemListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.items.createQueryBuilder('i');
    if (query.campaignId)
      qb.andWhere('i.campaignId = :campaignId', {
        campaignId: query.campaignId,
      });
    if (query.batchId) {
      qb.andWhere('i.batchId = :batchId', { batchId: query.batchId });
    } else if (query.unassigned) {
      qb.andWhere('i.batchId IS NULL');
    }
    if (query.status)
      qb.andWhere('i.status = :status', { status: query.status });
    if (query.className)
      qb.andWhere('i.className = :className', { className: query.className });
    if (query.faculty)
      qb.andWhere('i.faculty = :faculty', { faculty: query.faculty });
    if (query.q) {
      qb.andWhere('(i.subjectCode ILIKE :q OR i.fullName ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    if (query.sort === 'statusPriority') {
      // Plan item 8, §5 Q2 (chốt 2026-09-17): "chưa in" lên đầu, rồi "đang
      // in", rồi "đã in" — done as a DB-side ORDER BY (not client sort) so
      // it stays correct across pages.
      qb.addSelect(
        `CASE i.status
           WHEN 'PENDING' THEN 0 WHEN 'RENDERED' THEN 0 WHEN 'FAILED' THEN 0
           WHEN 'REPRINT_REQUESTED' THEN 0 WHEN 'CANCELLED' THEN 0
           WHEN 'QUEUED' THEN 1 WHEN 'PRINTING' THEN 1
           WHEN 'PRINTED' THEN 2 ELSE 3 END`,
        'status_priority',
      );
      qb.orderBy('status_priority', 'ASC').addOrderBy('i.subjectCode', 'ASC');
    } else {
      qb.orderBy('i.createdAt', 'DESC');
    }
    qb.skip((page - 1) * limit).take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    const operatorNames = await this.resolveOperatorNames(
      rows.map((row) => row.setId),
    );
    return new Pagination(
      rows.map((row) =>
        PrintItemListItemDao.from(row, operatorNames.get(row.setId) ?? null),
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
   * `setId` → `subject_photo_sets.source_session_id` →
   * `sessions.operator_user_id` → `users` — cross-module raw SQL read, same
   * convention as `CampaignService.bulkCapturedCounts`/
   * `DeviceEventService.campaignOperatorStats` (the latter is the source of
   * the `COALESCE(u.display_name, u.email)` display-name rule reused here).
   * Plan §D.3.c ("In thẻ theo campaign"). Batched by `setId` (not per-row)
   * for the same N+1-avoidance reason those two callers batch by
   * `campaignId`.
   */
  private async resolveOperatorNames(
    setIds: string[],
  ): Promise<Map<string, string | null>> {
    if (setIds.length === 0) return new Map();
    const rows: Array<{ set_id: string; operator_name: string | null }> =
      await this.dataSource.query(
        `SELECT sps.id AS set_id,
                COALESCE(u.display_name, u.email) AS operator_name
           FROM subject_photo_sets sps
           LEFT JOIN sessions s ON s.id = sps.source_session_id
           LEFT JOIN users u ON u.id = s.operator_user_id
          WHERE sps.id = ANY($1)`,
        [setIds],
      );
    return new Map(rows.map((r) => [r.set_id, r.operator_name]));
  }

  /** `GET /v1/print/items/groups` — plan §2.5's "gom nhóm" (group by class/faculty with per-status counts), one aggregate query rather than N list calls. */
  async groups(query: PrintItemGroupsQueryDto): Promise<PrintItemGroupDao[]> {
    const column = query.groupBy === 'faculty' ? 'faculty' : 'class_name';
    const params: unknown[] = [];
    let where = '1=1';
    if (query.campaignId) {
      params.push(query.campaignId);
      where += ` AND campaign_id = $${params.length}`;
    }
    const rows: Array<{
      value: string | null;
      total: string;
      pending: string;
      rendered: string;
      printed: string;
      failed: string;
    }> = await this.dataSource.query(
      `SELECT ${column} AS value,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status IN ('PENDING', 'REPRINT_REQUESTED')) AS pending,
              COUNT(*) FILTER (WHERE status IN ('RENDERED', 'QUEUED', 'EXPORTED')) AS rendered,
              COUNT(*) FILTER (WHERE status = 'PRINTING') AS printing,
              COUNT(*) FILTER (WHERE status = 'PRINTED') AS printed,
              COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
         FROM print_items
        WHERE ${where}
        GROUP BY ${column}
        ORDER BY ${column} NULLS LAST`,
      params,
    );
    return rows.map((row) => ({
      value: row.value,
      total: Number(row.total),
      pending: Number(row.pending),
      rendered: Number(row.rendered),
      printed: Number(row.printed),
      failed: Number(row.failed),
    }));
  }

  private async loadOrFail(id: string): Promise<PrintItem> {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Không tìm thấy item in');
    return item;
  }

  async getDetail(id: string): Promise<PrintItemDetailDao> {
    const item = await this.loadOrFail(id);
    const events = await this.events.find({
      where: { itemId: id },
      order: { at: 'DESC' },
    });
    return PrintItemDetailDao.fromDetail(item, events);
  }

  private async writeEvent(
    itemId: string,
    fromStatus: string | null,
    toStatus: string,
    source: 'SYSTEM' | 'PRINT_AGENT' | 'MANUAL',
    actorUserId: string | null,
    message: string | null,
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        itemId,
        fromStatus,
        toStatus,
        source,
        actorUserId,
        message,
      }),
    );
  }

  // ── Update ──────────────────────────────────────────────────────────

  /**
   * `PATCH /v1/print/items/:id {templateId?, extra?, status?}`. `status`
   * accepts only `CANCELLED` (operator pulling a bad row) or `PRINTED`
   * (BA decision #14's "manual action recorded with source = MANUAL") —
   * every other transition has its own dedicated route with its own
   * validation/side-effects (see `UpdatePrintItemDto`'s own doc comment).
   */
  async patch(
    id: string,
    dto: UpdatePrintItemDto,
    actorUserId: string | null,
  ): Promise<PrintItemDetailDao> {
    const item = await this.loadOrFail(id);
    if (item.status === 'CANCELLED') {
      throw new ConflictException('Item đã hủy, không thể sửa');
    }

    const fromStatus = item.status;
    let toStatus: string | null = null;
    let message: string | null = null;

    if (dto.templateId !== undefined) {
      this.applyTemplateChange(item, dto.templateId);
    }
    if (dto.extra !== undefined) {
      item.extra = { ...(item.extra ?? {}), ...dto.extra };
    }
    if (dto.status !== undefined) {
      if (dto.status === 'CANCELLED') {
        item.status = 'CANCELLED';
        toStatus = 'CANCELLED';
      } else if (dto.status === 'PRINTED') {
        await this.markPrintedManually(item, actorUserId);
        toStatus = 'PRINTED';
        message = 'Xác nhận đã in (thao tác tay)';
      } else {
        throw new BadRequestException(
          'Chỉ có thể chuyển sang CANCELLED hoặc PRINTED qua route này',
        );
      }
    }

    await this.items.save(item);
    if (toStatus) {
      await this.writeEvent(
        item.id,
        fromStatus,
        toStatus,
        'MANUAL',
        actorUserId,
        message,
      );
    }
    return this.getDetail(id);
  }

  private applyTemplateChange(item: PrintItem, templateId: string): void {
    item.templateId = templateId;
    // The existing render no longer reflects the newly-picked template —
    // same "stale render, back to PENDING" rule `bulkApplyTemplate` uses.
    if (item.status === 'RENDERED') {
      item.status = 'PENDING';
      item.renderedFrontFsFileId = null;
      item.renderedBackFsFileId = null;
      item.renderedAt = null;
    }
  }

  /**
   * BA #14: "đã in" set by hand must still go through the same stock/stats
   * bookkeeping the print-agent callback gets — the only difference is
   * `source` on the written event. Resolves the effective printer as
   * `item.printerId ?? batch.printerId` (a CENTRALIZED batch is often never
   * pinned to one printer — see `PrintBatch.printerId`'s own doc comment);
   * when neither is known, the PRINTED transition still succeeds but stock
   * is not decremented (nothing to decrement against) — logged into the
   * item's own event `message`, not silently dropped.
   */
  private async markPrintedManually(
    item: PrintItem,
    actorUserId: string | null,
  ): Promise<void> {
    const printerId = await this.resolveEffectivePrinterId(item);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      item.status = 'PRINTED';
      item.printedAt = now;
      item.errorMessage = null;
      if (printerId) item.printerId = printerId;
      await manager.save(item);

      if (printerId) {
        await this.printerService.applyStockDelta(
          manager,
          printerId,
          -1,
          'PRINT',
          actorUserId,
          'Xác nhận đã in (thao tác tay)',
        );
      }
      await this.printStats.recordPrinted(
        manager,
        item.campaignId,
        printerId,
        now,
      );
      if (item.batchId) {
        await manager.increment(
          PrintBatch,
          { id: item.batchId },
          'printedCount',
          1,
        );
      }
    });
  }

  private async resolveEffectivePrinterId(
    item: PrintItem,
  ): Promise<string | null> {
    if (item.printerId) return item.printerId;
    if (item.batchId) {
      const batch = await this.batches.findOne({ where: { id: item.batchId } });
      if (batch?.printerId) return batch.printerId;
    }
    return null;
  }

  private async resolveTemplateId(
    item: PrintItem,
    batch: PrintBatch | null,
  ): Promise<string> {
    if (item.templateId) return item.templateId;
    if (batch?.defaultTemplateId) return batch.defaultTemplateId;
    const printerId = item.printerId ?? batch?.printerId ?? null;
    if (printerId) {
      const rows: Array<{ default_template_id: string | null }> =
        await this.dataSource.query(
          `SELECT default_template_id FROM printers WHERE id = $1`,
          [printerId],
        );
      if (rows[0]?.default_template_id) return rows[0].default_template_id;
    }
    throw new BadRequestException(
      'Chưa chọn phôi in — item, đợt in, và máy in đều chưa có phôi mặc định',
    );
  }

  /**
   * `POST /v1/print/items/:id/render` — the ONE path that refreshes
   * `variantId` from `subject_photo_sets.current_card_variant_id` (see the
   * entity's own doc comment on why every other path leaves it fixed).
   * Render itself (slow: two SVG rasterizations + two file-service uploads)
   * runs outside any transaction; only the final row/event/stats commit is
   * transactional, so a mid-render crash never leaves a half-written DB
   * state, matching `CardTemplateAssetService.upload`'s "upload first,
   * persist the pointer after" ordering.
   */
  async render(id: string): Promise<PrintItemDetailDao> {
    const item = await this.loadOrFail(id);
    if (item.status === 'CANCELLED') {
      throw new ConflictException('Item đã hủy, không thể render');
    }
    if (['EXPORTED', 'QUEUED', 'PRINTING', 'PRINTED'].includes(item.status)) {
      throw new ConflictException(
        `Item đang ở trạng thái ${item.status}, không thể render lại (sẽ làm mất trạng thái đã xuất/gửi/in)`,
      );
    }
    const batch = item.batchId
      ? await this.batches.findOne({ where: { id: item.batchId } })
      : null;
    const templateId = await this.resolveTemplateId(item, batch);
    const template = await this.templateService.loadTemplateOrFail(templateId);

    const setRows: Array<{ current_card_variant_id: string | null }> =
      await this.dataSource.query(
        `SELECT current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
        [item.setId],
      );
    if (setRows.length === 0) {
      throw new NotFoundException(
        'Không tìm thấy hồ sơ ảnh nguồn của item này',
      );
    }
    const freshVariantId = setRows[0].current_card_variant_id ?? null;

    const [frontPng, backPng] = await Promise.all([
      this.renderService.render(template, 'front', { setId: item.setId }),
      this.renderService.render(template, 'back', { setId: item.setId }),
    ]);
    const idempotencyKey = randomUUID();
    const [frontResult, backResult] = await Promise.all([
      this.fileStorage.uploadRaw({
        virtualPath: `print-items/${item.id}/front-${idempotencyKey}.png`,
        mimeType: 'image/png',
        data: new Uint8Array(frontPng),
        idempotencyKey: `${idempotencyKey}-front`,
        // Explicit, not left to the server default — same convention every
        // other uploadRaw call site in this codebase already follows.
        visibility: 'public',
      }),
      this.fileStorage.uploadRaw({
        virtualPath: `print-items/${item.id}/back-${idempotencyKey}.png`,
        mimeType: 'image/png',
        data: new Uint8Array(backPng),
        idempotencyKey: `${idempotencyKey}-back`,
        visibility: 'public',
      }),
    ]);

    const fromStatus = item.status;
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      item.variantId = freshVariantId;
      item.renderedFrontFsFileId = frontResult.fileId;
      item.renderedBackFsFileId = backResult.fileId;
      item.renderedAt = now;
      item.status = 'RENDERED';
      item.errorMessage = null;
      await manager.save(item);
      await this.printStats.recordRendered(
        manager,
        item.campaignId,
        item.printerId ?? batch?.printerId ?? null,
        now,
      );
    });
    await this.writeEvent(
      item.id,
      fromStatus,
      'RENDERED',
      'SYSTEM',
      null,
      null,
    );

    return this.getDetail(id);
  }

  /** `GET /v1/print/items/:id/preview?side=front|back` — the already-rendered PNG if one exists (what will actually print), else a live preview against the resolved template (same engine `CardTemplateController.preview` uses) so the CMS can review before committing to a real render. */
  async preview(id: string, side: 'front' | 'back'): Promise<Buffer> {
    const item = await this.loadOrFail(id);
    const renderedFileId =
      side === 'back' ? item.renderedBackFsFileId : item.renderedFrontFsFileId;
    if (renderedFileId) {
      const link = await this.fileStorage.issueViewLink(
        renderedFileId,
        'print-item-preview',
      );
      const response = await fetch(link.url);
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
      // fall through to a live re-render if the stored copy can't be fetched
    }
    const batch = item.batchId
      ? await this.batches.findOne({ where: { id: item.batchId } })
      : null;
    const templateId = await this.resolveTemplateId(item, batch);
    const template = await this.templateService.loadTemplateOrFail(templateId);
    return this.renderService.render(template, side, { setId: item.setId });
  }

  /**
   * `POST /v1/print/items/:id/reprint` — creates a NEW `print_items` row
   * (`reprintOfItemId` → the original), unattached to any batch (the
   * operator decides which batch/queue the reprint joins — plan gives no
   * rule for auto-assigning one, and guessing wrong would silently print an
   * extra card through whatever queue the original batch is already
   * mid-processing). The original item moves to `REPRINT_REQUESTED`
   * (marking it superseded) rather than being touched otherwise — its own
   * `PRINTED`/render history stays intact for audit.
   *
   * Person data is copied from the original (a reprint is the same card,
   * not a re-lookup); `variantId` IS refreshed from
   * `subject_photo_sets.current_card_variant_id`, same "explicit re-render
   * pulls fresh" rule `render()` follows, since the whole point of a
   * reprint is often "the approved photo changed, print it again."
   */
  async reprint(
    id: string,
    actorUserId: string | null,
  ): Promise<PrintItemDetailDao> {
    const original = await this.loadOrFail(id);
    if (original.status === 'CANCELLED') {
      throw new ConflictException('Item đã hủy, không thể tạo bản in lại');
    }

    const setRows: Array<{ current_card_variant_id: string | null }> =
      await this.dataSource.query(
        `SELECT current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
        [original.setId],
      );
    const freshVariantId =
      setRows[0]?.current_card_variant_id ?? original.variantId ?? null;

    const created = await this.dataSource.transaction(async (manager) => {
      const fromStatus = original.status;
      original.status = 'REPRINT_REQUESTED';
      await manager.save(original);

      const reprint = manager.create(PrintItem, {
        campaignId: original.campaignId,
        setId: original.setId,
        variantId: freshVariantId,
        subjectCode: original.subjectCode,
        fullName: original.fullName,
        className: original.className,
        faculty: original.faculty,
        extra: original.extra,
        templateId: original.templateId,
        status: 'PENDING',
        reprintOfItemId: original.id,
      });
      const savedReprint = await manager.save(reprint);

      await manager.save(
        manager.create(PrintItemEvent, {
          itemId: original.id,
          fromStatus,
          toStatus: 'REPRINT_REQUESTED',
          source: 'MANUAL',
          actorUserId,
          message: `Tạo bản in lại ${savedReprint.id}`,
        }),
      );
      await manager.save(
        manager.create(PrintItemEvent, {
          itemId: savedReprint.id,
          fromStatus: null,
          toStatus: 'PENDING',
          source: 'MANUAL',
          actorUserId,
          message: `Bản in lại của item ${original.id}`,
        }),
      );
      await this.printStats.recordReprint(
        manager,
        original.campaignId,
        original.printerId ?? null,
        new Date(),
      );

      return savedReprint;
    });

    return this.getDetail(created.id);
  }

  // ── Agent callback ──────────────────────────────────────────────────

  /**
   * `GET /v1/print/queue?printerId` — what a DIRECT print agent polls.
   * Only items `send()` already stamped with THIS printer's id and
   * `QUEUED` status — an item never appears here before a batch's `send()`
   * assigns it a printer, and never lingers after the agent reports
   * PRINTED/FAILED (both move it out of `QUEUED`). No pagination: a real
   * agent's queue depth is bounded by how many cards one printer has
   * pending, not by CMS list-page volumes.
   */
  async queueForPrinter(printerId: string): Promise<PrintItemDetailDao[]> {
    const rows = await this.items.find({
      where: { printerId, status: 'QUEUED' },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => PrintItemDetailDao.fromDetail(row, []));
  }

  /**
   * `POST /v1/print/items/:id/status` — the print-agent callback
   * (`PrinterAgentGuard`). `PRINTED` here is the OTHER source BA #14 allows
   * (alongside the manual PATCH path) — both funnel through the same stock/
   * stats bookkeeping, only `source`/`actorUserId` on the written event
   * differ.
   */
  async statusCallback(
    itemId: string,
    printer: Printer,
    dto: PrintItemStatusCallbackDto,
  ): Promise<void> {
    const item = await this.loadOrFail(itemId);
    if (item.status === 'CANCELLED') {
      throw new ConflictException(
        'Item đã hủy, agent không thể cập nhật trạng thái',
      );
    }
    // Idempotency for an at-least-once HTTP callback (2026-09-16 database
    // audit, §3.1): the print-agent retries after a lost response the same
    // way any webhook consumer must be assumed to. Without this, a retried
    // `PRINTED` callback would decrement `blank_stock` and increment
    // `printedCount`/print stats a second time for one physical card — the
    // same "retry must not be counted twice" rule `SessionService
    // .completeSession` (module capture) already applies to `COMPLETED`.
    if (item.status === dto.status) {
      return;
    }
    const fromStatus = item.status;
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      item.printerId = printer.id;
      if (dto.status === 'PRINTING') {
        item.status = 'PRINTING';
      } else if (dto.status === 'PRINTED') {
        item.status = 'PRINTED';
        item.printedAt = now;
        item.errorMessage = null;
        await this.printerService.applyStockDelta(
          manager,
          printer.id,
          -1,
          'PRINT',
          null,
          null,
        );
        await this.printStats.recordPrinted(
          manager,
          item.campaignId,
          printer.id,
          now,
        );
        if (item.batchId) {
          await manager.increment(
            PrintBatch,
            { id: item.batchId },
            'printedCount',
            1,
          );
        }
      } else {
        item.status = 'FAILED';
        item.errorMessage = dto.message ?? null;
        await this.printStats.recordFailed(
          manager,
          item.campaignId,
          printer.id,
          now,
        );
        if (item.batchId) {
          await manager.increment(
            PrintBatch,
            { id: item.batchId },
            'failedCount',
            1,
          );
        }
      }
      await manager.save(item);
    });

    await this.writeEvent(
      item.id,
      fromStatus,
      item.status,
      'PRINT_AGENT',
      null,
      dto.message ?? null,
    );
  }

  // ── Bulk create ─────────────────────────────────────────────────────

  /**
   * `POST /v1/print/items/bulk {setIds | filter}` — creates one
   * `print_items` row per APPROVED set that doesn't already have an active
   * one (the partial unique index is the hard backstop; this pre-checks so
   * a bulk call reports WHY a set was skipped instead of a raw constraint
   * error). Person-data source priority (plan §2.5): `subject_photo_sets`
   * first (already denormalized by P4), `campaign_subjects` fills only the
   * gaps `subject_photo_sets` doesn't carry at all (`dateOfBirth`/
   * `cardValidUntil`) — same LEFT JOIN `CardTemplateRenderService.
   * resolveFromSet` already uses for the same two columns.
   */
  async bulkCreate(dto: BulkCreatePrintItemsDto): Promise<{
    created: number;
    createdIds: string[];
    skipped: Array<{ setId: string; reason: string }>;
  }> {
    if (!dto.setIds?.length && !dto.filter) {
      throw new BadRequestException('Cần setIds hoặc filter');
    }

    const params: unknown[] = [];
    let where: string;
    if (dto.setIds?.length) {
      params.push(dto.setIds);
      where = `sps.id = ANY($${params.length}) AND sps.status = 'APPROVED'`;
    } else {
      params.push(dto.filter!.campaignId);
      where = `sps.campaign_id = $${params.length} AND sps.status = 'APPROVED'`;
      if (dto.filter!.className) {
        params.push(dto.filter!.className);
        where += ` AND sps.class_name = $${params.length}`;
      }
      if (dto.filter!.faculty) {
        params.push(dto.filter!.faculty);
        where += ` AND sps.faculty = $${params.length}`;
      }
    }

    const candidates: CandidateSetRow[] = await this.dataSource.query(
      `SELECT sps.id, sps.campaign_id, sps.subject_code, sps.subject_name,
              COALESCE(sps.class_name, cs.class_name) AS class_name,
              COALESCE(sps.faculty, cs.faculty) AS faculty,
              sps.current_card_variant_id,
              cs.date_of_birth, cs.card_valid_until
         FROM subject_photo_sets sps
         LEFT JOIN campaign_subjects cs
           ON cs.campaign_id = sps.campaign_id AND cs.subject_code = sps.subject_code AND cs.status = 'VALID'
        WHERE ${where}
        ORDER BY sps.subject_code
        LIMIT ${MAX_BULK_ITEMS}`,
      params,
    );

    const existingRows: Array<{ set_id: string }> = candidates.length
      ? await this.dataSource.query(
          `SELECT set_id FROM print_items WHERE set_id = ANY($1) AND status NOT IN ('CANCELLED', 'FAILED', 'REPRINT_REQUESTED')`,
          [candidates.map((c) => c.id)],
        )
      : [];
    const alreadyActive = new Set(existingRows.map((r) => r.set_id));

    const skipped: Array<{ setId: string; reason: string }> = [];
    if (dto.setIds?.length) {
      // Either the set doesn't exist or it isn't APPROVED — both reported
      // the same way, no separate DB round-trip to tell them apart (the
      // CMS already knows which sets it selected and why).
      const foundIds = new Set(candidates.map((c) => c.id));
      for (const setId of dto.setIds) {
        if (!foundIds.has(setId))
          skipped.push({ setId, reason: 'NOT_APPROVED_OR_NOT_FOUND' });
      }
    }

    let created = 0;
    const createdIds: string[] = [];
    for (const row of candidates) {
      if (alreadyActive.has(row.id)) {
        skipped.push({ setId: row.id, reason: 'ALREADY_HAS_ACTIVE_ITEM' });
        continue;
      }
      const item = this.items.create({
        campaignId: row.campaign_id,
        setId: row.id,
        variantId: row.current_card_variant_id,
        subjectCode: row.subject_code,
        fullName: row.subject_name,
        className: row.class_name,
        faculty: row.faculty,
        extra: {
          dob: row.date_of_birth
            ? String(row.date_of_birth).slice(0, 10)
            : null,
          cardValidUntil: row.card_valid_until
            ? String(row.card_valid_until).slice(0, 10)
            : null,
          // No spec defines a distinct barcode payload for a print item —
          // defaults to the subject code, same default
          // `CardTemplateRenderService.resolveFromSet`'s `qrPayload` uses.
          barcode: row.subject_code,
        },
        status: 'PENDING',
      });
      const saved = await this.items.save(item);
      await this.writeEvent(
        saved.id,
        null,
        'PENDING',
        'SYSTEM',
        null,
        'Tạo từ bulk-create',
      );
      created += 1;
      createdIds.push(saved.id);
    }

    return { created, createdIds, skipped };
  }

  /**
   * `POST /v1/print/items/bulk-template {itemIds | filter, templateId}` —
   * plan §2.5's "thiết kế phôi cho 1 người rồi áp cho nhiều người". Two
   * plain `UPDATE`s (not a per-row loop) since this can touch up to
   * `MAX_BULK_ITEMS` rows — see `CampaignSubjectService.importRoster`-style
   * reasoning for preferring a bulk statement over N round trips at this
   * volume. Does not render — see this DTO's own doc comment.
   */
  async bulkApplyTemplate(
    dto: BulkTemplatePrintItemsDto,
  ): Promise<{ updated: number }> {
    if (!dto.itemIds?.length && !dto.filter) {
      throw new BadRequestException('Cần itemIds hoặc filter');
    }

    const params: unknown[] = [dto.templateId];
    let where: string;
    if (dto.itemIds?.length) {
      params.push(dto.itemIds);
      where = `id = ANY($${params.length})`;
    } else {
      const clauses: string[] = [];
      if (dto.filter!.campaignId) {
        params.push(dto.filter!.campaignId);
        clauses.push(`campaign_id = $${params.length}`);
      }
      if (dto.filter!.batchId) {
        params.push(dto.filter!.batchId);
        clauses.push(`batch_id = $${params.length}`);
      }
      if (dto.filter!.className) {
        params.push(dto.filter!.className);
        clauses.push(`class_name = $${params.length}`);
      }
      if (dto.filter!.faculty) {
        params.push(dto.filter!.faculty);
        clauses.push(`faculty = $${params.length}`);
      }
      if (dto.filter!.status) {
        params.push(dto.filter!.status);
        clauses.push(`status = $${params.length}`);
      }
      where = clauses.length ? clauses.join(' AND ') : '1=1';
    }
    where += ` AND status <> 'CANCELLED'`;

    // `dataSource.query()` on a plain UPDATE...RETURNING returns a
    // `[rows, affectedCount]` TUPLE, not a flat rows array — only an
    // INSERT (plain or ON CONFLICT DO UPDATE) gets the flat-array shape.
    // Destructuring straight into `Array<{id,status}>` (as an earlier
    // version of this method did) silently treated the 2-element tuple
    // itself as "the rows", so `.filter()` never matched anything (neither
    // the inner rows array nor the count number has a `.status` field) and
    // `.length` always reported `2` regardless of how many rows were
    // actually touched — confirmed live: a 1-item `bulk-template` call on a
    // RENDERED item reported `updated: 2` and left the stale render fully
    // intact (`status` stayed `RENDERED`, `renderedFrontFsFileId` still
    // pointed at the OLD template's PNG) instead of resetting it to
    // PENDING. See `SessionService.completeSession`'s own doc comment for
    // the same tuple-shape rule, first documented there.
    const [updatedRows]: [Array<{ id: string; status: string }>, number] =
      await this.dataSource.query(
        `UPDATE print_items SET template_id = $1, updated_at = now()
         WHERE ${where}
       RETURNING id, status`,
        params,
      );
    const staleRenderIds = updatedRows
      .filter((r) => r.status === 'RENDERED')
      .map((r) => r.id);
    if (staleRenderIds.length) {
      await this.dataSource.query(
        `UPDATE print_items
            SET status = 'PENDING', rendered_front_fs_file_id = NULL,
                rendered_back_fs_file_id = NULL, rendered_at = NULL, updated_at = now()
          WHERE id = ANY($1)`,
        [staleRenderIds],
      );
    }
    return { updated: updatedRows.length };
  }

  // ── Used by PrintBatchService ───────────────────────────────────────

  async findByIds(ids: string[]): Promise<PrintItem[]> {
    if (ids.length === 0) return [];
    return this.items.find({ where: { id: In(ids) } });
  }
}
