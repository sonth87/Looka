import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PrinterService } from './printer.service';

/**
 * Only exercises `applyStockDelta` — the method the 2026-09-16 database
 * audit flagged for a lost-update race (§3.1). A fake, single-threaded
 * `EntityManager` cannot prove two real concurrent callers no longer race
 * each other (that needs a live-DB persistence test against real
 * concurrent connections), but it does lock in the three outcomes the
 * atomic `UPDATE ... RETURNING` must produce, and specifically the
 * `[rows, rowCount]` tuple destructuring this codebase has gotten wrong
 * for an UPDATE's `RETURNING` result more than once elsewhere.
 *
 * Kept typed as a plain mock shape (not cast to `EntityManager` until the
 * call site) — same convention `campaign-member.guard.spec.ts` already
 * uses — so `expect(manager.query)...` reads a `jest.Mock`-typed property
 * instead of a real class method, which is what `@typescript-eslint
 * /unbound-method` would otherwise flag.
 */
function fakeManager(options: {
  updateRows: Array<{ blank_stock: number }>;
  printerExists: boolean;
}) {
  return {
    query: jest.fn().mockResolvedValue([options.updateRows, 0]),
    exists: jest.fn().mockResolvedValue(options.printerExists),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    save: jest.fn((entity: unknown) => entity),
  };
}

describe('PrinterService.applyStockDelta', () => {
  // Only the manager is used by this method — the other constructor
  // dependencies (repositories/dataSource) are irrelevant to it.
  const service = new PrinterService(
    undefined as never,
    undefined as never,
    undefined as never,
  );

  it('applies the delta atomically and records the resulting stock from RETURNING, not a value computed in JS', async () => {
    const manager = fakeManager({
      updateRows: [{ blank_stock: 47 }],
      printerExists: true,
    });

    const event = await service.applyStockDelta(
      manager as unknown as EntityManager,
      'printer-1',
      -3,
      'PRINT',
      null,
      null,
    );

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('blank_stock = blank_stock + $1'),
      [-3, 'printer-1'],
    );
    expect(event).toMatchObject({
      printerId: 'printer-1',
      delta: -3,
      reason: 'PRINT',
      resultingStock: 47,
    });
    // Never reads `printer.exists` on the success path — only the
    // conditional UPDATE, so the guard and the write are one round trip.
    expect(manager.exists).not.toHaveBeenCalled();
  });

  it('throws ConflictException, without writing an event, when the guard clause blocks a negative result', async () => {
    const manager = fakeManager({ updateRows: [], printerExists: true });

    await expect(
      service.applyStockDelta(
        manager as unknown as EntityManager,
        'printer-1',
        -100,
        'PRINT',
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the printer id does not exist at all, not ConflictException', async () => {
    const manager = fakeManager({ updateRows: [], printerExists: false });

    await expect(
      service.applyStockDelta(
        manager as unknown as EntityManager,
        'missing',
        -1,
        'PRINT',
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('destructures the UPDATE...RETURNING result as a [rows, rowCount] tuple, not a flat rows array', async () => {
    // If applyStockDelta ever regressed to `const rows = await manager.query(...)`
    // (the exact bug class this project has hit repeatedly for other
    // UPDATE/DELETE...RETURNING calls), `rows.length` would read the tuple's
    // own length (2) instead of the inner array's, and this assertion on
    // the successful branch actually running would fail.
    const manager = fakeManager({
      updateRows: [{ blank_stock: 10 }],
      printerExists: true,
    });

    const event = await service.applyStockDelta(
      manager as unknown as EntityManager,
      'printer-1',
      5,
      'REFILL',
      'user-1',
      'restocked',
    );

    expect(event.resultingStock).toBe(10);
    expect(manager.exists).not.toHaveBeenCalled();
  });
});
