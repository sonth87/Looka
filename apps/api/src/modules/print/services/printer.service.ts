import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import {
  CreatePrinterDto,
  ListPrintersQueryDto,
  PrinterHeartbeatDto,
  PrinterStockAdjustDto,
  UpdatePrinterDto,
} from '../dto';
import {
  PrinterDetailDao,
  PrinterListItemDao,
  PrinterStockEventDao,
} from '../dao';
import { Printer } from '../entities/printer.entity';
import { PrinterStockEvent } from '../entities/printer-stock-event.entity';
import type { PrinterStockEventReason } from '../print.constants';
import { generatePrinterToken, hashPrinterToken } from './printer-token.util';

/**
 * CRUD + lifecycle for `printers` (plan §2.7). Plain controller→service→
 * entity style, same reasoning `CardTemplateService`'s own doc comment
 * gives — a printer's rules (stock never negative, token shown once) are
 * each a single `if`, nothing warranting an aggregate.
 */
@Injectable()
export class PrinterService {
  constructor(
    @InjectRepository(Printer)
    private readonly printers: Repository<Printer>,
    @InjectRepository(PrinterStockEvent)
    private readonly stockEvents: Repository<PrinterStockEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async list(
    query: ListPrintersQueryDto,
  ): Promise<Pagination<PrinterListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const qb = this.printers.createQueryBuilder('p');
    if (query.status)
      qb.andWhere('p.status = :status', { status: query.status });
    if (query.q) {
      qb.andWhere('(p.name ILIKE :q OR p.model ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    // `printers` has no `campaign_id` column of its own — a printer's
    // campaign is derived transitively through the kiosk it is attached to
    // (`device_id` → `devices.campaign_id`, device-management, no FK — see
    // the migration's top comment). Cross-module raw-subquery filter,
    // same convention `PrintItemService`'s own cross-module reads use.
    if (query.campaignId) {
      qb.andWhere(
        'p.device_id IN (SELECT id FROM devices WHERE campaign_id = :campaignId)',
        { campaignId: query.campaignId },
      );
    }
    qb.orderBy('p.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [rows, totalItems] = await qb.getManyAndCount();
    return new Pagination(
      rows.map((row) => PrinterListItemDao.from(row)),
      {
        itemCount: rows.length,
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
      },
    );
  }

  private async loadOrFail(id: string): Promise<Printer> {
    const printer = await this.printers.findOne({ where: { id } });
    if (!printer) throw new NotFoundException('Không tìm thấy máy in');
    return printer;
  }

  private async hasToken(id: string): Promise<boolean> {
    const row = await this.printers
      .createQueryBuilder('p')
      .addSelect('p.agentTokenHash')
      .where('p.id = :id', { id })
      .getOne();
    return !!row?.agentTokenHash;
  }

  async getDetail(id: string): Promise<PrinterDetailDao> {
    const printer = await this.loadOrFail(id);
    const queueRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM print_items WHERE printer_id = $1 AND status IN ('QUEUED', 'PRINTING')`,
      [id],
    );
    const queueDepth = Number(queueRows[0]?.count ?? 0);
    const recentEvents = await this.stockEvents.find({
      where: { printerId: id },
      order: { at: 'DESC' },
      take: 20,
    });
    return PrinterDetailDao.fromDetail(
      printer,
      queueDepth,
      recentEvents,
      await this.hasToken(id),
    );
  }

  private async assertDeviceExists(deviceId: string): Promise<void> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM devices WHERE id = $1`,
      [deviceId],
    );
    if (rows.length === 0) {
      throw new BadRequestException('Không tìm thấy thiết bị (kiosk) này');
    }
  }

  async create(dto: CreatePrinterDto): Promise<PrinterListItemDao> {
    if (dto.deviceId) await this.assertDeviceExists(dto.deviceId);

    const printer = this.printers.create({
      name: dto.name,
      model: dto.model ?? null,
      printMode: dto.printMode ?? 'SINGLE_SIDE',
      usageMode: dto.usageMode ?? 'CENTRALIZED',
      location: dto.location ?? null,
      deviceId: dto.deviceId ?? null,
      connection: dto.connection ?? null,
      status: 'OFFLINE',
      blankStock: dto.blankStock ?? 0,
      blankStockUpdatedAt: dto.blankStock ? new Date() : null,
      lowStockThreshold: dto.lowStockThreshold ?? 0,
      defaultTemplateId: dto.defaultTemplateId ?? null,
    });
    const saved = await this.printers.save(printer);
    return PrinterListItemDao.from(saved);
  }

  async patch(id: string, dto: UpdatePrinterDto): Promise<PrinterListItemDao> {
    const printer = await this.loadOrFail(id);
    if (dto.deviceId !== undefined) {
      if (dto.deviceId) await this.assertDeviceExists(dto.deviceId);
      printer.deviceId = dto.deviceId ?? null;
    }
    if (dto.name !== undefined) printer.name = dto.name;
    if (dto.model !== undefined) printer.model = dto.model ?? null;
    if (dto.printMode !== undefined) printer.printMode = dto.printMode;
    if (dto.usageMode !== undefined) printer.usageMode = dto.usageMode;
    if (dto.location !== undefined) printer.location = dto.location ?? null;
    if (dto.connection !== undefined)
      printer.connection = dto.connection ?? null;
    if (dto.lowStockThreshold !== undefined)
      printer.lowStockThreshold = dto.lowStockThreshold;
    if (dto.defaultTemplateId !== undefined)
      printer.defaultTemplateId = dto.defaultTemplateId ?? null;

    const saved = await this.printers.save(printer);
    return PrinterListItemDao.from(saved);
  }

  /**
   * Core stock mutation, usable both inside a caller-owned transaction
   * (`PrintItemService`'s PRINTED transition passes its own `manager`, so
   * the stock decrement and the status/stats writes commit-or-rollback
   * together — plan §2.7/point 9's "transactional so stock and status can't
   * drift apart") and standalone (`adjustStock` below wraps this in its own
   * `dataSource.transaction`). Guards against a negative `blank_stock`
   * regardless of caller — a PRINT decrement racing an empty tray is a real
   * operational scenario (an operator forgot to refill), not just bad input.
   */
  async applyStockDelta(
    manager: EntityManager,
    printerId: string,
    delta: number,
    reason: PrinterStockEventReason,
    actorUserId: string | null,
    note: string | null,
  ): Promise<PrinterStockEvent> {
    const printer = await manager.findOne(Printer, {
      where: { id: printerId },
    });
    if (!printer) throw new NotFoundException('Không tìm thấy máy in');

    const resultingStock = printer.blankStock + delta;
    if (resultingStock < 0) {
      throw new ConflictException('Số phôi không đủ để thực hiện thao tác này');
    }

    printer.blankStock = resultingStock;
    printer.blankStockUpdatedAt = new Date();
    await manager.save(printer);

    const event = manager.create(PrinterStockEvent, {
      printerId,
      delta,
      reason,
      resultingStock,
      actorUserId,
      note,
    });
    return manager.save(event);
  }

  async adjustStock(
    id: string,
    dto: PrinterStockAdjustDto,
    actorUserId: string | null,
  ): Promise<PrinterStockEventDao> {
    const event = await this.dataSource.transaction((manager) =>
      this.applyStockDelta(
        manager,
        id,
        dto.delta,
        dto.reason,
        actorUserId,
        dto.note ?? null,
      ),
    );
    return PrinterStockEventDao.from(event);
  }

  async listStockEvents(
    id: string,
    page: number,
    limit: number,
  ): Promise<Pagination<PrinterStockEventDao>> {
    await this.loadOrFail(id);
    const [rows, totalItems] = await this.stockEvents.findAndCount({
      where: { printerId: id },
      order: { at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return new Pagination(
      rows.map((row) => PrinterStockEventDao.from(row)),
      {
        itemCount: rows.length,
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
      },
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<PrinterListItemDao> {
    const printer = await this.loadOrFail(id);
    printer.status = enabled ? 'OFFLINE' : 'DISABLED';
    const saved = await this.printers.save(printer);
    return PrinterListItemDao.from(saved);
  }

  /**
   * `POST /v1/printers/:id/test-print` — plan §2.7: "push 1 test job into
   * the queue". DIRECT mode's actual queue consumer (a print agent) is
   * explicitly out of scope this pass (D-Q8) — and `print_items.set_id` is
   * NOT NULL (every real item traces back to a person's photo set), so a
   * synthetic test job has no real row to become. This just validates the
   * printer is reachable/enabled and acknowledges — enough for the API
   * shape the plan asks for ("design the queue/callback/heartbeat API
   * shapes so an agent COULD consume them later") without inventing a fake
   * `print_items` row that would show up in real listings/counts.
   */
  async testPrint(
    id: string,
  ): Promise<{ acknowledged: true; printerId: string }> {
    const printer = await this.loadOrFail(id);
    if (printer.status === 'DISABLED') {
      throw new ConflictException('Máy in đang bị vô hiệu hóa');
    }
    return { acknowledged: true, printerId: printer.id };
  }

  /**
   * Shown once — same "generate, hash, store the hash, return the
   * plaintext, never again" pattern as `DeviceService.reissueDevice`/
   * `ActivationPackageService`. Rotating a token invalidates the previous
   * one immediately (unlike `Device`'s secret-rotation overlap window —
   * there is no live DIRECT-mode agent yet for an overlap to protect, so
   * the simpler immediate-cutover semantics are enough here).
   */
  async issueToken(id: string): Promise<{ token: string }> {
    await this.loadOrFail(id);
    const token = generatePrinterToken();
    await this.printers.update(id, { agentTokenHash: hashPrinterToken(token) });
    return { token };
  }

  async heartbeat(printer: Printer, dto: PrinterHeartbeatDto): Promise<void> {
    printer.status = dto.status;
    printer.lastSeenAt = new Date();
    printer.lastError = dto.status === 'ERROR' ? (dto.error ?? null) : null;
    await this.printers.save(printer);
  }
}
