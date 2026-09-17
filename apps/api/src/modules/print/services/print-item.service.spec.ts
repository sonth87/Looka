import { ConflictException } from '@nestjs/common';
import { Printer } from '../entities/printer.entity';
import { PrintItemService } from './print-item.service';
import { PrintItemStatusCallbackDto } from '../dto/print-item-status-callback.dto';

/**
 * Fakes are kept typed as plain object shapes (not cast to their real
 * class/interface until the `new PrintItemService(...)` call site) — same
 * convention `campaign-member.guard.spec.ts` already uses — so
 * `expect(x.method)...` reads a `jest.Mock`-typed property instead of a
 * real class method, which is what `@typescript-eslint/unbound-method`
 * would otherwise flag.
 */
function fakeItemsRepo(
  item: Partial<{ id: string; status: string; campaignId: string }>,
) {
  return { findOne: jest.fn().mockResolvedValue(item) };
}

function fakeEventsRepo() {
  return {
    create: jest.fn((data: unknown) => data),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeDataSource() {
  const manager = {
    save: jest.fn().mockResolvedValue(undefined),
    increment: jest.fn().mockResolvedValue(undefined),
  };
  return {
    transaction: jest.fn((fn: (manager: unknown) => Promise<void>) =>
      fn(manager),
    ),
  };
}

function fakePrinterService() {
  return { applyStockDelta: jest.fn().mockResolvedValue(undefined) };
}

function fakePrintStats() {
  return {
    recordPrinted: jest.fn().mockResolvedValue(undefined),
    recordFailed: jest.fn().mockResolvedValue(undefined),
  };
}

const PRINTER = { id: 'printer-1' } as Printer;

describe('PrintItemService.statusCallback — idempotency (2026-09-16 database audit §3.1)', () => {
  it('a duplicate PRINTED callback for an already-PRINTED item is a no-op: no stock decrement, no stats, no event', async () => {
    const items = fakeItemsRepo({
      id: 'item-1',
      status: 'PRINTED',
      campaignId: 'campaign-1',
    });
    const events = fakeEventsRepo();
    const dataSource = fakeDataSource();
    const printerService = fakePrinterService();
    const printStats = fakePrintStats();
    const service = new PrintItemService(
      items as never,
      events as never,
      undefined as never,
      dataSource as never,
      undefined as never,
      undefined as never,
      undefined as never,
      printStats as never,
      printerService as never,
    );

    const dto: PrintItemStatusCallbackDto = { status: 'PRINTED' };
    await service.statusCallback('item-1', PRINTER, dto);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(printerService.applyStockDelta).not.toHaveBeenCalled();
    expect(printStats.recordPrinted).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('a duplicate FAILED callback for an already-FAILED item is also a no-op (same shape of double-count risk)', async () => {
    const items = fakeItemsRepo({
      id: 'item-2',
      status: 'FAILED',
      campaignId: 'campaign-1',
    });
    const dataSource = fakeDataSource();
    const printStats = fakePrintStats();
    const service = new PrintItemService(
      items as never,
      fakeEventsRepo() as never,
      undefined as never,
      dataSource as never,
      undefined as never,
      undefined as never,
      undefined as never,
      printStats as never,
      fakePrinterService() as never,
    );

    await service.statusCallback('item-2', PRINTER, { status: 'FAILED' });

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(printStats.recordFailed).not.toHaveBeenCalled();
  });

  it('a genuine transition (QUEUED -> PRINTED) still runs the full transaction exactly once', async () => {
    const items = fakeItemsRepo({
      id: 'item-3',
      status: 'QUEUED',
      campaignId: 'campaign-1',
    });
    const events = fakeEventsRepo();
    const dataSource = fakeDataSource();
    const printerService = fakePrinterService();
    const printStats = fakePrintStats();
    const service = new PrintItemService(
      items as never,
      events as never,
      undefined as never,
      dataSource as never,
      undefined as never,
      undefined as never,
      undefined as never,
      printStats as never,
      printerService as never,
    );

    await service.statusCallback('item-3', PRINTER, { status: 'PRINTED' });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(printerService.applyStockDelta).toHaveBeenCalledTimes(1);
    expect(printStats.recordPrinted).toHaveBeenCalledTimes(1);
    expect(events.save).toHaveBeenCalledTimes(1);
  });

  it('a CANCELLED item still rejects every callback, unaffected by the new idempotency check', async () => {
    const items = fakeItemsRepo({ id: 'item-4', status: 'CANCELLED' });
    const service = new PrintItemService(
      items as never,
      fakeEventsRepo() as never,
      undefined as never,
      fakeDataSource() as never,
      undefined as never,
      undefined as never,
      undefined as never,
      fakePrintStats() as never,
      fakePrinterService() as never,
    );

    await expect(
      service.statusCallback('item-4', PRINTER, { status: 'PRINTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
