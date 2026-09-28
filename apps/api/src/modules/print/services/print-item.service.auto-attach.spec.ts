import { QueryFailedError } from 'typeorm';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItemService } from './print-item.service';

/**
 * `PrintItemService.onSetApproved`/`onSetLeftApproved` — the
 * `PhotoSetStatusChangedEvent` handler's support methods (task brief rules
 * 1/2, "cứ duyệt xong thì sẽ có trong đợt in" / withdraw on leaving
 * APPROVED). Both take an explicit `manager` (never `this.dataSource`/
 * `this.items`) since they must run inside `PhotoReviewService`'s own
 * transaction — see `PhotoSetStatusChangedHandler`'s own doc comment.
 *
 * Fakes follow the same shape/style as `print-batch.service.exportPackage
 * .spec.ts`'s `fakeManager` (match on SQL substring) and `print-item.service
 * .spec.ts`'s plain-object fakes — no NestJS `TestingModule` needed since
 * neither method under test touches DI-injected collaborators.
 */
describe('PrintItemService — PhotoSetStatusChangedEvent support', () => {
  function fakeManager(opts: {
    targetBatchRows?: Array<{ id: string }>;
    existingItemRows?: Array<{
      id: string;
      batch_id: string | null;
      status: string;
    }>;
    candidateRows?: Array<Record<string, unknown>>;
    attachUpdateRows?: Array<{ id: string }>;
    cancelRows?: Array<{
      id: string;
      from_status: string;
      batch_id: string | null;
    }>;
    insertRejectsWith?: Error;
  }) {
    const printItemRepo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn((entity: unknown) => {
        if (opts.insertRejectsWith)
          return Promise.reject(opts.insertRejectsWith);
        return Promise.resolve({ id: 'new-item-1', ...(entity as object) });
      }),
    };
    const printItemEventRepo = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === PrintItem) return printItemRepo;
      if (entity === PrintItemEvent) return printItemEventRepo;
      throw new Error('unexpected getRepository() call in test');
    });
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM print_batches') && sql.includes('mode =')) {
        return Promise.resolve(opts.targetBatchRows ?? []);
      }
      if (sql.includes('SELECT id, batch_id, status FROM print_items')) {
        return Promise.resolve(opts.existingItemRows ?? []);
      }
      if (sql.includes('FROM subject_photo_sets sps')) {
        return Promise.resolve(opts.candidateRows ?? []);
      }
      if (sql.includes('UPDATE print_items SET batch_id')) {
        return Promise.resolve([
          opts.attachUpdateRows ?? [],
          (opts.attachUpdateRows ?? []).length,
        ]);
      }
      if (sql.includes('WITH old AS')) {
        const rows = opts.cancelRows ?? [];
        return Promise.resolve([rows, rows.length]);
      }
      if (sql.includes('UPDATE print_batches SET item_count = GREATEST')) {
        return Promise.resolve([[], 0]);
      }
      // Savepoint bracketing around the risky INSERT — see onSetApproved's
      // own doc comment (2026-09-25 fix). Matched with `startsWith` so
      // `RELEASE SAVEPOINT ...`/`ROLLBACK TO SAVEPOINT ...` don't also match
      // the plain `SAVEPOINT ...` branch (both contain the substring).
      if (
        sql.startsWith('SAVEPOINT') ||
        sql.startsWith('RELEASE SAVEPOINT') ||
        sql.startsWith('ROLLBACK TO SAVEPOINT')
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected manager.query: ${sql}`));
    });
    const increment = jest.fn().mockResolvedValue(undefined);
    return {
      query,
      getRepository,
      increment,
      printItemRepo,
      printItemEventRepo,
    };
  }

  function buildService() {
    // Every constructor param besides what these two methods actually use
    // (none — both are pure `manager`-driven) is irrelevant here, same
    // `undefined as never` convention `print-item.service.spec.ts` uses.
    return new PrintItemService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  }

  const CANDIDATE_ROW = {
    id: 'set-1',
    campaign_id: 'campaign-1',
    subject_code: 'SV001',
    subject_name: 'Nguyen Van A',
    class_name: 'D20CQCN01',
    faculty: 'CNTT',
    current_card_variant_id: 'variant-1',
    date_of_birth: null,
    card_valid_until: null,
  };

  describe('onSetApproved', () => {
    it('creates a new item and attaches it when a CENTRALIZED batch is open', async () => {
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'batch-1',
          setId: 'set-1',
          status: 'PENDING',
        }),
      );
      expect(manager.printItemRepo.save).toHaveBeenCalledTimes(1);
      expect(manager.increment).toHaveBeenCalledWith(
        PrintBatch,
        { id: 'batch-1' },
        'itemCount',
        1,
      );
      expect(manager.printItemEventRepo.save).toHaveBeenCalledTimes(1);
    });

    it('creates the item unattached when no CENTRALIZED batch is open (documented behavior — a later populate() sweeps it up)', async () => {
      const manager = fakeManager({
        targetBatchRows: [], // no open batch
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: null, setId: 'set-1' }),
      );
      expect(manager.printItemRepo.save).toHaveBeenCalledTimes(1);
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('a DIRECT-only open batch is never picked as the target (findTargetCentralizedBatch filters by mode in SQL, simulated here as "no rows")', async () => {
      const manager = fakeManager({
        targetBatchRows: [], // the mode='CENTRALIZED' filter excludes the DIRECT batch
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: null }),
      );
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('is a no-op when an active item already exists and is already attached (no duplicate)', async () => {
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [
          { id: 'item-1', batch_id: 'batch-1', status: 'PENDING' },
        ],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.save).not.toHaveBeenCalled();
      expect(manager.increment).not.toHaveBeenCalled();
      expect(manager.printItemEventRepo.save).not.toHaveBeenCalled();
    });

    it('attaches an existing UNATTACHED active item to the target batch instead of creating a duplicate', async () => {
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [{ id: 'item-1', batch_id: null, status: 'PENDING' }],
        attachUpdateRows: [{ id: 'item-1' }],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.save).not.toHaveBeenCalled(); // no new item
      expect(manager.increment).toHaveBeenCalledWith(
        PrintBatch,
        { id: 'batch-1' },
        'itemCount',
        1,
      );
      expect(manager.printItemEventRepo.save).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the set is no longer APPROVED by the time this runs (race with a later transition)', async () => {
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [],
        candidateRows: [], // SELECT ... WHERE status = 'APPROVED' found nothing
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      expect(manager.printItemRepo.save).not.toHaveBeenCalled();
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('swallows a lost create-race against the UQ_print_items_set_id_active constraint rather than throwing, and rolls back ONLY to the savepoint (2026-09-25 fix)', async () => {
      // `driverError` is a readonly ctor param on `QueryFailedError` — pass
      // the fake pg driver error shape directly rather than constructing
      // then reassigning.
      const constraintError = new QueryFailedError('INSERT', undefined, {
        code: '23505',
        constraint: 'UQ_print_items_set_id_active',
      } as unknown as Error);
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
        insertRejectsWith: constraintError,
      });
      const service = buildService();

      await expect(
        service.onSetApproved(manager as never, 'set-1', 'campaign-1'),
      ).resolves.toBeUndefined();
      expect(manager.increment).not.toHaveBeenCalled();
      expect(manager.printItemEventRepo.save).not.toHaveBeenCalled();

      // The bug this guards against: catching the 23505 with a bare
      // try/catch (no savepoint) leaves the SHARED caller transaction
      // aborted — every later statement in photo-review's own approval
      // transaction would then fail with "current transaction is aborted"
      // and COMMIT would silently become ROLLBACK, losing the approval
      // itself. A `SAVEPOINT` before the risky INSERT, released on success
      // or rolled back to (not the whole transaction) on this specific
      // benign error, is what keeps the rest of that shared transaction
      // usable.
      const calls = manager.query.mock.calls.map((c) => c[0]);
      const savepointIdx = calls.findIndex(
        (sql) => sql === 'SAVEPOINT print_item_auto_create',
      );
      const rollbackIdx = calls.findIndex(
        (sql) => sql === 'ROLLBACK TO SAVEPOINT print_item_auto_create',
      );
      expect(savepointIdx).toBeGreaterThanOrEqual(0);
      expect(rollbackIdx).toBeGreaterThan(savepointIdx);
      // Never released — the INSERT never succeeded, nothing to release.
      expect(calls).not.toContain('RELEASE SAVEPOINT print_item_auto_create');
    });

    it("propagates a genuine DB error (not the active-set constraint) — this must roll back the caller's transaction, but still rolls back to the savepoint first so the caller's own ROLLBACK doesn't hit an already-aborted sub-transaction", async () => {
      const genuineError = new Error('connection terminated unexpectedly');
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
        insertRejectsWith: genuineError,
      });
      const service = buildService();

      await expect(
        service.onSetApproved(manager as never, 'set-1', 'campaign-1'),
      ).rejects.toBe(genuineError);

      const calls = manager.query.mock.calls.map((c) => c[0]);
      expect(calls).toContain('ROLLBACK TO SAVEPOINT print_item_auto_create');
    });

    it('releases the savepoint (does not roll back) on a successful create', async () => {
      const manager = fakeManager({
        targetBatchRows: [{ id: 'batch-1' }],
        existingItemRows: [],
        candidateRows: [CANDIDATE_ROW],
      });
      const service = buildService();

      await service.onSetApproved(manager as never, 'set-1', 'campaign-1');

      const calls = manager.query.mock.calls.map((c) => c[0]);
      const savepointIdx = calls.findIndex(
        (sql) => sql === 'SAVEPOINT print_item_auto_create',
      );
      const releaseIdx = calls.findIndex(
        (sql) => sql === 'RELEASE SAVEPOINT print_item_auto_create',
      );
      expect(savepointIdx).toBeGreaterThanOrEqual(0);
      expect(releaseIdx).toBeGreaterThan(savepointIdx);
      expect(calls).not.toContain(
        'ROLLBACK TO SAVEPOINT print_item_auto_create',
      );
    });
  });

  describe('onSetLeftApproved', () => {
    it('cancels a PENDING/RENDERED active item and decrements the batch counter', async () => {
      const manager = fakeManager({
        cancelRows: [
          { id: 'item-1', from_status: 'PENDING', batch_id: 'batch-1' },
        ],
      });
      const service = buildService();

      await service.onSetLeftApproved(manager as never, 'set-1');

      const eventData = manager.printItemEventRepo.create.mock.calls[0][0] as {
        itemId: string;
        fromStatus: string;
        toStatus: string;
        source: string;
        message: string;
      };
      expect(eventData.itemId).toBe('item-1');
      expect(eventData.fromStatus).toBe('PENDING');
      expect(eventData.toStatus).toBe('CANCELLED');
      expect(eventData.source).toBe('SYSTEM');
      expect(eventData.message).toContain('Tự rút khỏi đợt in');
      expect(manager.printItemEventRepo.save).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('GREATEST(item_count - 1, 0)'),
        ['batch-1'],
      );
    });

    it('leaves an EXPORTED (or any non-PENDING/RENDERED) item completely untouched', async () => {
      const manager = fakeManager({ cancelRows: [] }); // the CTE's own WHERE excludes it
      const service = buildService();

      await service.onSetLeftApproved(manager as never, 'set-1');

      expect(manager.printItemEventRepo.save).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('GREATEST'),
        expect.anything(),
      );
    });

    it('cancels an unattached active item without touching any batch counter', async () => {
      const manager = fakeManager({
        cancelRows: [{ id: 'item-1', from_status: 'RENDERED', batch_id: null }],
      });
      const service = buildService();

      await service.onSetLeftApproved(manager as never, 'set-1');

      expect(manager.printItemEventRepo.save).toHaveBeenCalledTimes(1);
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('GREATEST'),
        expect.anything(),
      );
    });
  });
});
