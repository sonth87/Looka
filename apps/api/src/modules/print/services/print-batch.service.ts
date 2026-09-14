import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import {
  CreatePrintBatchDto,
  ListPrintBatchesQueryDto,
  UpdatePrintBatchDto,
} from '../dto';
import { PrintBatchDetailDao, PrintBatchListItemDao } from '../dao';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
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
  constructor(
    @InjectRepository(PrintBatch)
    private readonly batches: Repository<PrintBatch>,
    @InjectRepository(PrintItem) private readonly items: Repository<PrintItem>,
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
      await this.items.update(
        { id: In(newlyAdded.map((i) => i.id)) },
        { batchId: id },
      );
      batch.itemCount += newlyAdded.length;
      await this.batches.save(batch);
    }
    return PrintBatchDetailDao.fromDetail(batch);
  }

  async removeItem(id: string, itemId: string): Promise<void> {
    const batch = await this.loadOrFail(id);
    this.assertEditable(batch);
    const item = await this.itemService.findByIds([itemId]);
    if (!item[0] || item[0].batchId !== id) {
      throw new NotFoundException('Item không thuộc đợt in này');
    }
    await this.items.update(itemId, { batchId: null });
    batch.itemCount = Math.max(0, batch.itemCount - 1);
    await this.batches.save(batch);
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
    const toRender = items.filter(
      (i) => i.status !== 'CANCELLED' && i.status !== 'RENDERED',
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
      batch.status = 'READY';
      await this.batches.save(batch);
    }
    return { rendered, failed: errors.length, errors };
  }

  /**
   * `POST /v1/print/batches/:id/send` — DIRECT queues every RENDERED item
   * (`status → QUEUED`) for a print agent to drain (D-Q8: that agent is out
   * of scope, so items simply sit QUEUED — see `PrintAgentController`'s own
   * doc comment); CENTRALIZED goes straight to `DONE` since the system's
   * whole job for that mode ends at "package is available to download"
   * (`GET .../package`, built fresh on demand — see `PrintPackageService`),
   * there is no further state a centralized batch waits through.
   */
  async send(id: string): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    if (batch.itemCount === 0) {
      throw new BadRequestException('Đợt in chưa có item nào');
    }
    if (!['DRAFT', 'READY'].includes(batch.status)) {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể gửi in`,
      );
    }

    const now = new Date();
    if (batch.mode === 'DIRECT') {
      // The agent's queue poll (`GET /v1/print/queue?printerId`) filters by
      // `print_items.printer_id` — an item must be stamped with a printer
      // before it can ever show up there, so DIRECT `send()` requires the
      // batch to already have one (`PATCH .../batches/:id {printerId}`
      // beforehand), unlike CENTRALIZED where `printerId` stays optional.
      if (!batch.printerId) {
        throw new BadRequestException(
          'Đợt in DIRECT cần gán máy in trước khi gửi',
        );
      }
      const result = await this.items.update(
        { batchId: id, status: 'RENDERED' as PrintItem['status'] },
        { status: 'QUEUED', printerId: batch.printerId },
      );
      if (!result.affected) {
        throw new BadRequestException(
          'Chưa có item nào ở trạng thái RENDERED để gửi in',
        );
      }
      batch.status = 'PRINTING';
      batch.sentAt = now;
    } else {
      const renderedCount = await this.items.count({
        where: { batchId: id, status: 'RENDERED' },
      });
      if (renderedCount === 0) {
        throw new BadRequestException(
          'Chưa có item nào được render để xuất gói',
        );
      }
      batch.status = 'DONE';
      batch.sentAt = now;
      batch.doneAt = now;
    }
    const saved = await this.batches.save(batch);
    return PrintBatchDetailDao.fromDetail(saved);
  }

  async cancel(id: string): Promise<PrintBatchDetailDao> {
    const batch = await this.loadOrFail(id);
    if (batch.status === 'DONE' || batch.status === 'CANCELLED') {
      throw new ConflictException(
        `Đợt in đang ở trạng thái ${batch.status}, không thể hủy`,
      );
    }
    // Items keep their own status/batchId untouched (plan gives no cascade
    // rule) — an operator can still see/re-add them to another batch;
    // cancelling the batch only stops IT from being sent/packaged again.
    batch.status = 'CANCELLED';
    const saved = await this.batches.save(batch);
    return PrintBatchDetailDao.fromDetail(saved);
  }

  async package(id: string): Promise<{ zip: Buffer; filename: string }> {
    const batch = await this.loadOrFail(id);
    const zip = await this.packageService.buildPackage(batch);
    return { zip, filename: `print-batch-${batch.code}.zip` };
  }
}
