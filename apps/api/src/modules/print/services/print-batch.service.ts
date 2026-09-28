import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import {
  CreatePrintBatchDto,
  ListPrintBatchesQueryDto,
  UpdatePrintBatchDto,
} from '../dto';
import { PrintBatchDetailDao, PrintBatchListItemDao } from '../dao';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { PrintItemService } from './print-item.service';
import { PrintPackageService } from './print-package.service';

const EDITABLE_BATCH_STATUSES = ['DRAFT', 'READY'];

/**
 * `print_batches` CRUD + lifecycle — plan §2.5. Batch `code` is
 * server-generated (`PB-yyyyMMdd-xxxx`) since the plan's `POST` body
 * example never asks the caller for one — same "generate, retry on
 * collision" shape `CardTemplateService.duplicate` uses for its own
 * `-COPY`/`-COPY2` codes, just with a random suffix instead of an
 * incrementing one (a batch code has no natural "next" the way a
 * duplicate's does).
 */
@Injectable()
export class PrintBatchService {
  private readonly logger = new Logger(PrintBatchService.name);

  constructor(
    @InjectRepository(PrintBatch)
    private readonly batches: Repository<PrintBatch>,
    @InjectRepository(PrintItem) private readonly items: Repository<PrintItem>,
    @InjectRepository(PrintItemEvent)
    private readonly events: Repository<PrintItemEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly itemService: PrintItemService,
    private readonly packageService: PrintPackageService,
  ) {}

  async list(
    query: ListPrintBatchesQueryDto,
  ): Promise<Pagination<PrintBatchListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const qb = this.batches.createQueryBuilder('b');
    if (query.status)
      qb.andWhere('b.status = :status', { status: query.status });
    if (query.campaignId)
      qb.andWhere('b.campaignId = :campaignId', {
        campaignId: query.campaignId,
      });
    qb.orderBy('b.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    return new Pagination(
      rows.map((row) => PrintBatchListItemDao.from(row)),
      {
        itemCount: rows.length,
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
      },
    );
  }

  private async loadOrFail(id: string): Promise<PrintBatch> {
    const batch = await this.batches.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Không tìm thấy đợt in');
    return batch;
  }

  async getDetail(id: string): Promise<PrintBatchDetailDao> {
    return PrintBatchDetailDao.fromDetail(await this.loadOrFail(id));
  }

  private async generateCode(): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      const code = `PB-${datePart}-${suffix}`;
      const existing = await this.batches.findOne({ where: { code } });
      if (!existing) return code;
    }
    // 10 collisions in a row on a 4-char random suffix is astronomically
    // unlikely — falling back to a full random id keeps this from ever
    // throwing outright rather than chasing a theoretical infinite loop.
    return `PB-${datePart}-${Date.now().toString(36).toUpperCase()}`;
  }

  async create(
    dto: CreatePrintBatchDto,
    userId: string | null,
  ): Promise<PrintBatchDetailDao> {
    const batch = this.batches.create({
      code: await this.generateCode(),
      name: dto.name,
      campaignId: dto.campaignId ?? null,
      defaultTemplateId: dto.defaultTemplateId ?? null,
      printerId: dto.printerId ?? null,
      mode: dto.mode ?? 'CENTRALIZED',
      status: 'DRAFT',
      createdByUserId: userId,
    });
    const saved = await this.batches.save(batch);
    return PrintBatchDetailDao.fromDetail(saved);
  }

  private assertEditable(batch: PrintBatch): void {
    if (!EDITABLE_BATCH_STATUSES.includes(batch.status)) {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể sửa`,
      );
    }
  }

  async patch(
    id: string,
    dto: UpdatePrintBatchDto,
  ): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);

    if (dto.name !== undefined) batch.name = dto.name;
    if (dto.defaultTemplateId !== undefined)
      batch.defaultTemplateId = dto.defaultTemplateId ?? null;
    if (dto.printerId !== undefined) batch.printerId = dto.printerId ?? null;
    if (dto.mode !== undefined) batch.mode = dto.mode;

    const saved = await this.batches.save(batch);
    return PrintBatchDetailDao.fromDetail(saved);
  }

  /** `POST /v1/print/batches/:id/items {itemIds}` — an item can belong to only one batch at a time (`print_items.batch_id` is a single column, not an array); moving an item already in a DIFFERENT batch requires removing it there first, so a CMS click can never silently steal a row another batch is mid-processing. */
  async addItems(id: string, itemIds: string[]): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);

    const items = await this.itemService.findByIds(itemIds);
    const foundIds = new Set(items.map((i) => i.id));
    const missing = itemIds.filter((i) => !foundIds.has(i));
    if (missing.length) {
      throw new NotFoundException(`Không tìm thấy item: ${missing.join(', ')}`);
    }
    const conflicting = items.find((i) => i.batchId && i.batchId !== id);
    if (conflicting) {
      throw new ConflictException(
        `Item ${conflicting.id} đã thuộc đợt in khác — cần gỡ trước khi thêm vào đợt này`,
      );
    }
    const cancelled = items.find((i) => i.status === 'CANCELLED');
    if (cancelled) {
      throw new BadRequestException(
        `Item ${cancelled.id} đã hủy, không thể thêm vào đợt in`,
      );
    }

    const newlyAdded = items.filter((i) => i.batchId !== id);
    if (newlyAdded.length) {
      // Guarded `UPDATE ... RETURNING` (not a stale `batch.itemCount +=`
      // `save(batch)`) — TypeORM 0.3's `save` re-diffs and writes back
      // EVERY column that differs from the current DB row against the
      // entity loaded at the top of this method, so a long-running sibling
      // call (e.g. `render()`, which can take minutes) that saved its own
      // change to this same batch in the meantime would get silently
      // reverted here. `itemCount` is only incremented by the rows THIS
      // call actually claimed, and the `(batch_id IS NULL OR batch_id =
      // $1)` guard means an item another request claimed for a different
      // batch in the window between the check above and this write is left
      // alone rather than stolen.
      const [movedRows]: [Array<{ id: string }>, number] =
        await this.dataSource.query(
          `UPDATE print_items SET batch_id = $1, updated_at = now()
             WHERE id = ANY($2) AND (batch_id IS NULL OR batch_id = $1)
           RETURNING id`,
          [id, newlyAdded.map((i) => i.id)],
        );
      if (movedRows.length) {
        await this.dataSource.query(
          `UPDATE print_batches SET item_count = item_count + $2, updated_at = now() WHERE id = $1`,
          [id, movedRows.length],
        );
      }
    }
    return PrintBatchDetailDao.fromDetail(await this.loadOrFail(id));
  }

  async removeItem(id: string, itemId: string): Promise<void> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);
    const item = await this.itemService.findByIds([itemId]);
    if (!item[0] || item[0].batchId !== id) {
      throw new NotFoundException('Item không thuộc đợt in này');
    }
    await this.items.update(itemId, { batchId: null });
    // Atomic decrement, not a stale `save(batch)` — same reasoning as
    // `addItems()`'s own note.
    await this.dataSource.query(
      `UPDATE print_batches SET item_count = GREATEST(item_count - 1, 0), updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  /** `POST /v1/print/batches/:id/items/remove {itemIds}` — bulk mirror of the single-item `DELETE .../items/:itemId` above; same "item stays, only loses batchId" semantics, just for many at once. */
  async removeItems(
    id: string,
    itemIds: string[],
  ): Promise<{ removed: number }> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);
    const items = await this.itemService.findByIds(itemIds);
    const foundIds = new Set(items.map((i) => i.id));
    const missing = itemIds.filter((i) => !foundIds.has(i));
    if (missing.length) {
      throw new NotFoundException(`Không tìm thấy item: ${missing.join(', ')}`);
    }
    const foreign = items.find((i) => i.batchId !== id);
    if (foreign) {
      throw new NotFoundException(`Item ${foreign.id} không thuộc đợt in này`);
    }
    await this.items.update({ id: In(itemIds) }, { batchId: null });
    // Atomic decrement, not a stale `save(batch)` — same reasoning as
    // `addItems()`'s own note.
    await this.dataSource.query(
      `UPDATE print_batches SET item_count = GREATEST(item_count - $2, 0), updated_at = now() WHERE id = $1`,
      [id, itemIds.length],
    );
    return { removed: itemIds.length };
  }

  /**
   * `POST /v1/print/batches/:id/populate` — Giai đoạn 4 (plan §4.1, feature
   * 2). Requires the batch to already have a `campaignId` (set at create
   * time or via `PATCH`). Reuses `PrintItemService.bulkCreate`'s existing
   * campaign+APPROVED query for brand-new items, then ALSO attaches every
   * already-existing item for this campaign that isn't in any batch yet —
   * both count as "chưa được nạp vào đợt này", matching the plan's own
   * "nạp toàn bộ ảnh đã duyệt" wording rather than only the freshly-created
   * ones (an item can pre-exist unassigned from an earlier `bulk` call or
   * from being removed from a different batch).
   */
  async populate(id: string): Promise<{
    created: number;
    attached: number;
    skipped: Array<{ setId: string; reason: string }>;
  }> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);
    if (!batch.campaignId) {
      throw new BadRequestException(
        'Đợt in chưa gắn campaign — không thể nạp tự động',
      );
    }

    const { createdIds, skipped } = await this.itemService.bulkCreate({
      filter: { campaignId: batch.campaignId },
    });

    const unassigned = await this.items.find({
      where: {
        campaignId: batch.campaignId,
        batchId: IsNull(),
        status: Not('CANCELLED'),
      },
    });
    const idsToAttach = Array.from(
      new Set([...createdIds, ...unassigned.map((i) => i.id)]),
    );
    let attached = 0;
    if (idsToAttach.length) {
      // Guarded `UPDATE ... RETURNING` + atomic increment — same reasoning
      // as `addItems()`'s own note (a stale `batch.itemCount +=`
      // `save(batch)` here would both lose concurrent increments and risk
      // clobbering a concurrent unrelated change to this batch row).
      const [movedRows]: [Array<{ id: string }>, number] =
        await this.dataSource.query(
          `UPDATE print_items SET batch_id = $1, updated_at = now()
             WHERE id = ANY($2) AND (batch_id IS NULL OR batch_id = $1)
           RETURNING id`,
          [id, idsToAttach],
        );
      attached = movedRows.length;
      if (attached) {
        await this.dataSource.query(
          `UPDATE print_batches SET item_count = item_count + $2, updated_at = now() WHERE id = $1`,
          [id, attached],
        );
      }
    }

    return {
      created: createdIds.length,
      attached,
      skipped,
    };
  }

  /** Shared by `send()`/`package()`: when a caller passes an explicit `itemIds` subset, every id must actually be a member of this batch — a foreign or unknown id is a 400, never silently ignored (task brief §Task A point 2). */
  private async assertItemsBelongToBatch(
    id: string,
    itemIds: string[],
  ): Promise<void> {
    const items = await this.itemService.findByIds(itemIds);
    const foundIds = new Set(items.map((i) => i.id));
    const missing = itemIds.filter((i) => !foundIds.has(i));
    if (missing.length) {
      throw new BadRequestException(
        `Không tìm thấy item: ${missing.join(', ')}`,
      );
    }
    const foreign = items.find((i) => i.batchId !== id);
    if (foreign) {
      throw new BadRequestException(
        `Item ${foreign.id} không thuộc đợt in này`,
      );
    }
  }

  /**
   * `POST /v1/print/batches/:id/render` — renders every not-yet-RENDERED
   * item in the batch. Runs SYNCHRONOUSLY within the request (unlike
   * `StatsRebuildService.rebuild`'s fire-and-forget): a print batch is
   * bounded by how many items an operator put in it (closer to
   * `CampaignSubjectService.importRoster`'s "a human is already waiting on
   * a single bounded file" shape than an open-ended multi-day stats
   * rebuild), and the caller needs the per-item pass/fail result to know
   * what to fix before sending. One item's render failure does not abort
   * the rest — each is try/caught so a batch of 200 with one bad photo
   * still renders the other 199.
   */
  async render(id: string): Promise<{
    rendered: number;
    failed: number;
    errors: Array<{ itemId: string; message: string }>;
  }> {
    const batch = await this.loadOrFail(id);
    const items = await this.items.find({
      where: { batchId: id },
    });
    // Only items that have never been rendered (or need re-rendering after
    // a failure/reprint) are eligible — an EXPORTED/QUEUED/PRINTING/PRINTED
    // item must NOT be regressed back to RENDERED here, or a batch already
    // exported/sent/printed would silently lose that state.
    const toRender = items.filter((i) =>
      ['PENDING', 'FAILED', 'REPRINT_REQUESTED'].includes(i.status),
    );

    let rendered = 0;
    const errors: Array<{ itemId: string; message: string }> = [];
    for (const item of toRender) {
      try {
        await this.itemService.render(item.id);
        rendered += 1;
      } catch (error) {
        errors.push({ itemId: item.id, message: (error as Error).message });
      }
    }
    if (batch.status === 'DRAFT' && rendered > 0) {
      // Targeted, guarded `UPDATE` (not `save(batch)`) — this method can
      // run for minutes over hundreds of items (see its own doc comment).
      // `batch` was loaded once at the very top, so blind-saving that
      // in-memory entity back at the end would silently overwrite any
      // `printerId`/`defaultTemplateId`/status change an operator made
      // through `PATCH`/`cancel()` while the render was still in flight,
      // reverting it back to what it was when this call started. The
      // `WHERE status = 'DRAFT'` guard also means this only ever flips
      // DRAFT → READY, never re-applies over a batch someone cancelled or
      // otherwise moved on in the meantime.
      await this.batches.update({ id, status: 'DRAFT' }, { status: 'READY' });
    }
    return { rendered, failed: errors.length, errors };
  }

  /**
   * `POST /v1/print/batches/:id/send` — DIRECT ONLY: queues every RENDERED
   * item (`status → QUEUED`) for a print agent to drain (D-Q8: that agent
   * is out of scope, so items simply sit QUEUED — see
   * `PrintAgentController`'s own doc comment). CENTRALIZED used to jump
   * straight to `DONE` here (plan §4.0 Bẫy 4, "đợt CENTRALIZED nhảy thẳng
   * DONE") — that single step is now two explicit ones, `exportPackage()`
   * ("Xuất gói") and `complete()` ("Hoàn tất đợt"); calling `send()` on a
   * CENTRALIZED batch is now a 400 pointing at those instead.
   */
  async send(id: string, itemIds?: string[]): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    if (batch.mode !== 'DIRECT') {
      throw new BadRequestException(
        'Đợt CENTRALIZED không dùng "gửi in" — dùng "Xuất gói" (POST .../package) rồi "Hoàn tất đợt" (POST .../complete)',
      );
    }
    if (batch.itemCount === 0) {
      throw new BadRequestException('Đợt in chưa có item nào');
    }
    if (!['DRAFT', 'READY'].includes(batch.status)) {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể gửi in`,
      );
    }
    if (itemIds?.length) {
      await this.assertItemsBelongToBatch(id, itemIds);
    }

    // The agent's queue poll (`GET /v1/print/queue?printerId`) filters by
    // `print_items.printer_id` — an item must be stamped with a printer
    // before it can ever show up there, so DIRECT `send()` requires the
    // batch to already have one (`PATCH .../batches/:id {printerId}`
    // beforehand).
    if (!batch.printerId) {
      throw new BadRequestException(
        'Đợt in DIRECT cần gán máy in trước khi gửi',
      );
    }
    const where: FindOptionsWhere<PrintItem> = {
      batchId: id,
      status: 'RENDERED',
    };
    if (itemIds?.length) where.id = In(itemIds);
    const result = await this.items.update(where, {
      status: 'QUEUED',
      printerId: batch.printerId,
    });
    if (!result.affected) {
      throw new BadRequestException(
        'Chưa có item nào ở trạng thái RENDERED để gửi in',
      );
    }
    // Targeted, guarded `UPDATE` (not `batch.status = ...; save(batch)`) —
    // same reasoning as this file's other blind-`save`-after-an-async-gap
    // fixes this session (`addItems`/`removeItem`/`render`'s own doc
    // comments). `batch` was loaded at the very top of this method, and the
    // two awaits above it (`assertItemsBelongToBatch`, the items `UPDATE`)
    // are a real gap in which a concurrent `PATCH .../batches/:id` could
    // have changed `printerId`/`defaultTemplateId`/`name` on this same row —
    // a blind `save(batch)` here would silently revert that change back to
    // what it was when `send()` started. The `status IN (...)` guard means
    // this only ever moves DRAFT/READY → PRINTING, never re-applies over a
    // batch someone cancelled in that same window.
    await this.batches.update(
      { id, status: In(['DRAFT', 'READY']) },
      { status: 'PRINTING', sentAt: new Date() },
    );
    return PrintBatchDetailDao.fromDetail(await this.loadOrFail(id));
  }

  /**
   * `POST /v1/print/batches/:id/package {itemIds?}` — Giai đoạn 4 (plan
   * §4.0 Bẫy 4+6, §4.2) — "Xuất gói", the CENTRALIZED replacement for what
   * `send()`'s old CENTRALIZED branch used to do. Builds the SAME zip
   * `GET .../package` returns (read-only, unchanged, see
   * `PrintPackageService`), but only stamps `exportedAt`/promotes
   * PENDING/RENDERED→EXPORTED items AFTER the zip has actually finished
   * building (plan's own "sau khi zip dựng xong" — a failed zip build must
   * never stamp anything). Repeatable: re-exporting an already-EXPORTED/
   * PRINTED item just refreshes its `exportedAt` and appends a new
   * `print_item_events` row, never regresses its status ("Xuất lại lần
   * nữa thì cập nhật exported_at thành lần mới nhất").
   *
   * 2026-09-25 product decision: the zip no longer carries rendered
   * card-template PNGs (see `PrintPackageService`'s own doc comment), so
   * `render()` is no longer a precondition for CENTRALIZED export — an
   * item may be exported straight from PENDING. `PrintPackageService
   * .buildPackage` is the one that decides per-item eligibility now (set
   * still APPROVED + has a current card variant, re-checked live); this
   * method only narrows by STATUS up front, to keep CANCELLED/FAILED/
   * REPRINT_REQUESTED/QUEUED/PRINTING items out of the zip and out of any
   * stamping entirely.
   */
  async exportPackage(
    id: string,
    itemIds: string[] | undefined,
    actorUserId: string | null,
  ): Promise<{ zip: Buffer; filename: string; failedItemIds: string[] }> {
    const batch = await this.loadOrFail(id);
    if (!['DRAFT', 'READY'].includes(batch.status)) {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể xuất gói`,
      );
    }
    if (itemIds?.length) {
      await this.assertItemsBelongToBatch(id, itemIds);
    }

    const where: FindOptionsWhere<PrintItem> = { batchId: id };
    if (itemIds?.length) where.id = In(itemIds);
    const scopedItems = await this.items.find({ where });
    // PENDING is now a valid starting point for export (see this method's
    // own doc comment) — CANCELLED/FAILED/REPRINT_REQUESTED/QUEUED/
    // PRINTING are excluded regardless of what `PrintPackageService` might
    // otherwise be able to find a photo for; those statuses must never be
    // zipped, stamped exported_at, or given a false "re-exported" event.
    const exportable = scopedItems.filter((i) =>
      ['PENDING', 'RENDERED', 'EXPORTED', 'PRINTED'].includes(i.status),
    );
    if (exportable.length === 0) {
      throw new BadRequestException(
        'Chưa có item nào ở trạng thái phù hợp để xuất gói',
      );
    }

    // Build the zip from exactly the same id set that gets stamped below —
    // never the broader `itemIds`/batch scope, so a CANCELLED or
    // REPRINT_REQUESTED item (which has a stale rendered PNG but was
    // filtered out of `exportable` above) can never end up in the package.
    const exportableIds = exportable.map((i) => i.id);
    const { zip, includedItemIds, failedItemIds } =
      await this.packageService.buildPackage(batch, exportableIds);

    // Only items whose image(s) actually made it into the zip may be
    // stamped as exported/"chờ in" — `buildPackage` can silently drop an
    // item when its file-service download fails (403/5xx/timeout), and the
    // doc comment on this method promises stamping only happens "AFTER the
    // zip has actually finished building" for that item. Stamping a whole
    // `exportable` set regardless of `failedItemIds` would tell the
    // operator a card is waiting to print when the print vendor never
    // received its image.
    const includedSet = new Set(includedItemIds);
    const stampable = exportable.filter((i) => includedSet.has(i.id));
    if (stampable.length === 0) {
      throw new BadRequestException(
        'Không thể đóng gói ảnh cho item nào đã chọn — hồ sơ chưa duyệt/chưa có ảnh thẻ đã duyệt, hoặc tải ảnh từ file-service thất bại, vui lòng thử lại',
      );
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      // PENDING items are now a valid promote source alongside RENDERED
      // (see this method's own doc comment — render is no longer a
      // precondition for CENTRALIZED export).
      const toPromoteIds = stampable
        .filter((i) => i.status === 'PENDING' || i.status === 'RENDERED')
        .map((i) => i.id);
      const toRestampIds = stampable
        .filter((i) => i.status !== 'PENDING' && i.status !== 'RENDERED')
        .map((i) => i.id);
      // Guarded by status (and, implicitly, by only ever touching ids this
      // request itself just verified belong to this batch and are in the
      // zip) + `RETURNING id` — `buildPackage` can run for a long time
      // downloading every item's photos one after another, so a concurrent
      // result-file upload, `removeItems`, or item cancellation could have
      // moved one of these ids on since `scopedItems` was read above. Only
      // rows still actually PENDING/RENDERED (or still EXPORTED/PRINTED,
      // for the restamp) get touched, and events are written only for what
      // really changed — never for the stale in-memory snapshot.
      let promotedIds: string[] = [];
      let restampedIds: string[] = [];
      if (toPromoteIds.length) {
        // `error_message = NULL` — 2026-09-25 product rule: a PENDING/
        // RENDERED item can carry a stale error from an earlier
        // `PrintResultImportService` "In thất bại" regression (see that
        // service's `resolvePriorStatus`); re-exporting it is the operator
        // saying "try again", so the old error must not still show once it's
        // back out "chờ in" — the next result upload's own outcome is what
        // should set it again, if it fails a second time.
        const [rows]: [Array<{ id: string }>, number] = await manager.query(
          `UPDATE print_items SET status = 'EXPORTED', exported_at = $2, error_message = NULL, updated_at = now()
             WHERE id = ANY($1) AND status IN ('PENDING', 'RENDERED') AND batch_id = $3
           RETURNING id`,
          [toPromoteIds, now, id],
        );
        promotedIds = rows.map((r) => r.id);
      }
      if (toRestampIds.length) {
        const [rows]: [Array<{ id: string }>, number] = await manager.query(
          `UPDATE print_items SET exported_at = $2, updated_at = now()
             WHERE id = ANY($1) AND status IN ('EXPORTED', 'PRINTED') AND batch_id = $3
           RETURNING id`,
          [toRestampIds, now, id],
        );
        restampedIds = rows.map((r) => r.id);
      }
      const promotedSet = new Set(promotedIds);
      const restampedSet = new Set(restampedIds);
      const actuallyStamped = stampable.filter(
        (i) => promotedSet.has(i.id) || restampedSet.has(i.id),
      );
      if (actuallyStamped.length) {
        await manager.save(
          PrintItemEvent,
          actuallyStamped.map((item) =>
            this.events.create({
              itemId: item.id,
              fromStatus: item.status,
              toStatus: promotedSet.has(item.id) ? 'EXPORTED' : item.status,
              source: 'MANUAL',
              actorUserId,
              message: promotedSet.has(item.id)
                ? 'Xuất gói'
                : 'Xuất gói lại (đã EXPORTED/PRINTED trước đó)',
            }),
          ),
        );
      }
      await manager.update(PrintBatch, id, {
        sentAt: now,
        lastExportedAt: now,
      });
    });

    if (failedItemIds.length > 0) {
      this.logger.warn(
        `exportPackage: batch ${id} — ${failedItemIds.length} item(s) could not be packaged and were NOT stamped as exported: ${failedItemIds.join(', ')}`,
      );
    }

    return {
      zip,
      filename: `print-batch-${batch.code}.zip`,
      failedItemIds,
    };
  }

  /**
   * `POST /v1/print/batches/:id/complete` — Giai đoạn 4 (plan §4.0 Bẫy 4)
   * — "Hoàn tất đợt", the OTHER half of what `send()`'s old CENTRALIZED
   * branch used to do in one step. Requires at least one item already
   * `EXPORTED`/`PRINTED` — a batch with only `RENDERED` items has nothing
   * confirmed as physically handed off yet, so there is nothing to
   * "complete".
   */
  async complete(id: string): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    if (batch.mode !== 'CENTRALIZED') {
      throw new BadRequestException(
        'Chỉ đợt CENTRALIZED mới dùng "Hoàn tất đợt"',
      );
    }
    if (!['DRAFT', 'READY'].includes(batch.status)) {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể hoàn tất`,
      );
    }
    const exportedCount = await this.items.count({
      where: { batchId: id, status: In(['EXPORTED', 'PRINTED']) },
    });
    if (exportedCount === 0) {
      throw new BadRequestException(
        'Chưa xuất gói item nào — xuất gói trước khi hoàn tất đợt',
      );
    }
    batch.status = 'DONE';
    batch.doneAt = new Date();
    const saved = await this.batches.save(batch);
    return PrintBatchDetailDao.fromDetail(saved);
  }

  /**
   * 2026-09-28 product decision (gap live-confirmed in
   * `print-direct-flow.live.spec.ts`, test "6b"): a DIRECT item still
   * sitting QUEUED in the agent's queue (`GET /v1/print/queue`) is NOT
   * stopped by cancelling the batch alone — a real agent would still print
   * it. This now cascade-cancels QUEUED → CANCELLED. PRINTING is
   * deliberately left alone: the agent has already claimed it and the
   * physical print may already be underway, so flipping its DB status at
   * that point would only desync system state from reality without
   * stopping anything real (same "can't un-print a page" reasoning as
   * `patch()`'s own PRINTED-is-terminal guard). Every other status
   * (PENDING/RENDERED/EXPORTED/PRINTED/etc.) still keeps the old behavior —
   * untouched, operator can still see/re-add it to another batch.
   * CENTRALIZED batches never have QUEUED items (only DIRECT `send()` ever
   * sets that status), so the cascade is a no-op for them.
   */
  async cancel(
    id: string,
    actorUserId: string | null,
  ): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    if (batch.status === 'DONE' || batch.status === 'CANCELLED') {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể hủy`,
      );
    }
    batch.status = 'CANCELLED';
    await this.dataSource.transaction(async (manager) => {
      await manager.save(batch);
      const [rows]: [Array<{ id: string }>, number] = await manager.query(
        `UPDATE print_items SET status = 'CANCELLED', updated_at = now()
           WHERE batch_id = $1 AND status = 'QUEUED'
         RETURNING id`,
        [id],
      );
      if (rows.length) {
        await manager.save(
          PrintItemEvent,
          rows.map((row) =>
            this.events.create({
              itemId: row.id,
              fromStatus: 'QUEUED',
              toStatus: 'CANCELLED',
              source: 'MANUAL',
              actorUserId,
              message: 'Tự hủy theo đợt in bị hủy',
            }),
          ),
        );
      }
    });
    return PrintBatchDetailDao.fromDetail(await this.loadOrFail(id));
  }

  /**
   * `GET /v1/print/batches/:id/package` — read-only re-download, UNCHANGED
   * by Giai đoạn 4 (plan §4.0 Bẫy 6: "giữ nguyên GET... làm đường tải lại
   * thuần đọc"). Never stamps `exportedAt` or touches item status — a
   * browser prefetch/retry/shared link all fire plain GETs, so a GET must
   * never have a side effect. Use `exportPackage()` (the `POST` twin) to
   * actually record an export.
   */
  async package(
    id: string,
    itemIds?: string[],
  ): Promise<{ zip: Buffer; filename: string }> {
    const batch = await this.loadOrFail(id);
    if (itemIds?.length) {
      await this.assertItemsBelongToBatch(id, itemIds);
    }
    const { zip } = await this.packageService.buildPackage(batch, itemIds);
    return { zip, filename: `print-batch-${batch.code}.zip` };
  }
}
