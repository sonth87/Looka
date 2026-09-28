import { BadRequestException } from '@nestjs/common';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintBatchService } from './print-batch.service';

/**
 * `PrintBatchService.exportPackage` — 2026-09-25 product decision: render is
 * no longer a precondition for CENTRALIZED "Xuất gói" (`PrintPackageService`
 * now packages the approved card photo, not a rendered card-template PNG),
 * so a PENDING item must be promotable straight to EXPORTED, alongside the
 * already-supported RENDERED. Only items `PrintPackageService.buildPackage`
 * reports as actually zipped (`includedItemIds`) may be stamped — an item
 * `buildPackage` reports as failed (`failedItemIds`, e.g. its set is no
 * longer APPROVED) must be left completely untouched.
 */
describe('PrintBatchService.exportPackage', () => {
  function fakeManager(promoteIds: string[], restampIds: string[]) {
    const query = jest.fn((sql: string) => {
      if (sql.includes("status = 'EXPORTED'")) {
        return Promise.resolve([
          promoteIds.map((id) => ({ id })),
          promoteIds.length,
        ]);
      }
      if (sql.includes('SET exported_at')) {
        return Promise.resolve([
          restampIds.map((id) => ({ id })),
          restampIds.length,
        ]);
      }
      return Promise.reject(new Error(`unexpected manager.query: ${sql}`));
    });
    return {
      query,
      // Typed args (not a bare `jest.fn()`) so `.mock.calls[i][1]` below
      // comes back as `unknown[]`, not `any` — keeps
      // `@typescript-eslint/no-unsafe-member-access` happy without an
      // unnecessary cast.
      save: jest.fn((_entity: unknown, _rows: unknown[]) =>
        Promise.resolve(undefined),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
  }

  function buildService(opts: {
    batch: Partial<PrintBatch>;
    scopedItems: Array<Partial<PrintItem>>;
    buildPackageResult: {
      zip: Buffer;
      includedItemIds: string[];
      failedItemIds: string[];
    };
    manager: ReturnType<typeof fakeManager>;
  }) {
    const batches = { findOne: jest.fn().mockResolvedValue(opts.batch) };
    const items = { find: jest.fn().mockResolvedValue(opts.scopedItems) };
    const events = { create: jest.fn((data: unknown) => data) };
    const dataSource = {
      transaction: jest.fn((fn: (manager: unknown) => Promise<void>) =>
        fn(opts.manager),
      ),
    };
    const packageService = {
      buildPackage: jest.fn().mockResolvedValue(opts.buildPackageResult),
    };
    const service = new PrintBatchService(
      batches as never,
      items as never,
      events as never,
      dataSource as never,
      undefined as never, // itemService — unused by exportPackage() itself
      packageService as never,
    );
    return { service, batches, items, events, dataSource, packageService };
  }

  it('promotes PENDING and RENDERED items to EXPORTED, restamps already-EXPORTED items, and leaves a failedItemIds item completely untouched', async () => {
    const batch = { id: 'batch-1', code: 'PB-1', status: 'DRAFT' };
    const scopedItems: Array<Partial<PrintItem>> = [
      { id: 'item-1', status: 'PENDING', batchId: 'batch-1' },
      { id: 'item-2', status: 'RENDERED', batchId: 'batch-1' },
      { id: 'item-3', status: 'EXPORTED', batchId: 'batch-1' },
      { id: 'item-4', status: 'CANCELLED', batchId: 'batch-1' },
      { id: 'item-5', status: 'QUEUED', batchId: 'batch-1' },
      { id: 'item-6', status: 'PENDING', batchId: 'batch-1' }, // will fail in buildPackage
    ];
    const manager = fakeManager(['item-1', 'item-2'], ['item-3']);
    const { service, packageService } = buildService({
      batch,
      scopedItems,
      buildPackageResult: {
        zip: Buffer.from('fake-zip'),
        includedItemIds: ['item-1', 'item-2', 'item-3'],
        failedItemIds: ['item-6'],
      },
      manager,
    });

    const result = await service.exportPackage('batch-1', undefined, 'user-1');

    // exportable scope excludes CANCELLED/QUEUED up front (item-4, item-5
    // never even get offered to buildPackage).
    expect(packageService.buildPackage).toHaveBeenCalledWith(batch, [
      'item-1',
      'item-2',
      'item-3',
      'item-6',
    ]);

    // PENDING (item-1) + RENDERED (item-2) promoted via the guarded
    // `status IN ('PENDING','RENDERED')` UPDATE — which also clears a stale
    // `error_message` a prior result-upload "In thất bại" regression may
    // have left (2026-09-25 product rule: re-exporting is the operator
    // saying "try again", see `PrintResultImportService.resolvePriorStatus`'s
    // own doc comment for the regression this undoes).
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('PENDING', 'RENDERED')"),
      [['item-1', 'item-2'], expect.any(Date), 'batch-1'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('error_message = NULL'),
      [['item-1', 'item-2'], expect.any(Date), 'batch-1'],
    );
    // Already-EXPORTED item-3 only gets exported_at refreshed.
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET exported_at'),
      [['item-3'], expect.any(Date), 'batch-1'],
    );

    // Events written for exactly the 3 stamped items (item-6 excluded).
    const savedEvents = manager.save.mock.calls[0][1] as Array<{
      itemId: string;
      toStatus: string;
      message: string;
    }>;
    expect(savedEvents.map((e) => e.itemId).sort()).toEqual([
      'item-1',
      'item-2',
      'item-3',
    ]);
    expect(savedEvents.find((e) => e.itemId === 'item-1')?.toStatus).toBe(
      'EXPORTED',
    );
    expect(savedEvents.find((e) => e.itemId === 'item-3')?.message).toContain(
      'lại',
    ); // "Xuất gói lại..." — already EXPORTED before this call

    expect(result.failedItemIds).toEqual(['item-6']);
  });

  it('rejects with the updated Vietnamese message when no item in scope is in an exportable status', async () => {
    const batch = { id: 'batch-1', code: 'PB-1', status: 'DRAFT' };
    const scopedItems: Array<Partial<PrintItem>> = [
      { id: 'item-1', status: 'CANCELLED', batchId: 'batch-1' },
      { id: 'item-2', status: 'QUEUED', batchId: 'batch-1' },
    ];
    const { service } = buildService({
      batch,
      scopedItems,
      buildPackageResult: {
        zip: Buffer.from(''),
        includedItemIds: [],
        failedItemIds: [],
      },
      manager: fakeManager([], []),
    });

    await expect(
      service.exportPackage('batch-1', undefined, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.exportPackage('batch-1', undefined, 'user-1'),
    ).rejects.toThrow('Chưa có item nào ở trạng thái phù hợp để xuất gói');
  });

  it('rejects when every exportable item failed to package (nothing actually zipped)', async () => {
    const batch = { id: 'batch-1', code: 'PB-1', status: 'DRAFT' };
    const scopedItems: Array<Partial<PrintItem>> = [
      { id: 'item-1', status: 'PENDING', batchId: 'batch-1' },
    ];
    const { service } = buildService({
      batch,
      scopedItems,
      buildPackageResult: {
        zip: Buffer.from(''),
        includedItemIds: [],
        failedItemIds: ['item-1'],
      },
      manager: fakeManager([], []),
    });

    await expect(
      service.exportPackage('batch-1', undefined, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
