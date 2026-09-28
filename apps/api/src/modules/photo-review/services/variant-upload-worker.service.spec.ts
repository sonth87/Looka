import { FsError } from '@face/fs-client';
import {
  VariantUploadWorkerService,
  computeVariantNextRetryAt,
} from './variant-upload-worker.service';

/**
 * `VariantUploadWorkerService` had NO coverage at all before this task
 * (task item 3 — "variant-upload-worker.service.ts actually drains PENDING
 * -> uploaded rows"). A REAL live `drain()` call against the shared dev
 * `camera` database was deliberately NOT attempted here: `claimNext()`'s
 * `FOR UPDATE SKIP LOCKED` claim has no per-test scoping at all — it claims
 * the OLDEST due `variant_upload_outbox` row in the WHOLE table, which on a
 * live, shared dev DB could just as easily be a real row from real
 * dev/kiosk traffic (or another agent's own fixture) as one of this test's
 * own. A fake `DataSource`/`FileStorageService` (same "match on SQL
 * substring" style `print-item.service.auto-attach.spec.ts` and
 * `print-batch.service.exportPackage.spec.ts` already use for exactly this
 * reason) gives real behavioral coverage of `claimNext`/`send`/`pollScans`
 * without that risk.
 */
describe('VariantUploadWorkerService', () => {
  describe('computeVariantNextRetryAt', () => {
    it('grows exponentially with attempts; the exponent itself is clamped to 8 before the 300s cap is even applied, so the real ceiling this function ever produces is 2**8=256s, not the nominal 300s constant', () => {
      const now = 1_700_000_000_000;
      expect(computeVariantNextRetryAt(0, now).getTime() - now).toBe(1_000);
      expect(computeVariantNextRetryAt(1, now).getTime() - now).toBe(2_000);
      expect(computeVariantNextRetryAt(3, now).getTime() - now).toBe(8_000);
      expect(computeVariantNextRetryAt(8, now).getTime() - now).toBe(256_000);
      // MINOR (reported, not fixed): `exponent` is clamped to a max of 8
      // BEFORE `2 ** exponent` is compared against the 300s cap, so
      // `Math.min(300, 2**exponent)` can only ever see values up to 256 —
      // `VARIANT_OUTBOX_MAX_RETRY_DELAY_SECONDS` (300) is dead: no attempts
      // count, however large, ever produces more than a 256s delay.
      // Harmless (256s is already a reasonable backoff ceiling) but worth
      // noting since the constant's own name promises 300s.
      expect(computeVariantNextRetryAt(9, now).getTime() - now).toBe(256_000);
      expect(computeVariantNextRetryAt(50, now).getTime() - now).toBe(256_000);
    });

    it('treats a negative/non-finite attempts count as 0 rather than crashing or going negative', () => {
      const now = 1_700_000_000_000;
      expect(computeVariantNextRetryAt(-5, now).getTime() - now).toBe(1_000);
      expect(computeVariantNextRetryAt(NaN, now).getTime() - now).toBe(1_000);
    });
  });

  /**
   * Same "match on SQL substring" fake as this module's print-side sibling
   * specs. `claimRows` is a QUEUE, not a static return value — `drain()`'s
   * own `for (;;) { claimNext(); ... }` loop calls `claimNext()` repeatedly
   * until it comes back empty (real `FOR UPDATE SKIP LOCKED` semantics:
   * each row is claimed at most once), so a fake that kept returning the
   * same row would make that loop spin forever.
   */
  function fakeDataSource(opts: {
    claimRows?: unknown[];
    scanRows?: unknown[];
    queryImpl?: (sql: string, params?: unknown[]) => unknown;
  }) {
    const claimQueue = [...(opts.claimRows ?? [])];
    const query = jest.fn((sql: string, params?: unknown[]) => {
      if (opts.queryImpl) {
        const custom = opts.queryImpl(sql, params);
        if (custom !== undefined) return custom;
      }
      if (
        sql.includes('UPDATE variant_upload_outbox') &&
        sql.includes("SET status = 'SENDING'")
      ) {
        const row = claimQueue.shift();
        return row ? [[row], 1] : [[], 0];
      }
      if (sql.includes('SELECT id, fs_file_id')) {
        return opts.scanRows ?? [];
      }
      return [];
    });
    return { query } as unknown as import('typeorm').DataSource;
  }

  const JOB_ROW = {
    id: 'outbox-1',
    variant_id: 'variant-1',
    idem_key: 'idem-1',
    virtual_path: 'zztest/1.jpg',
    mime_type: 'image/jpeg',
    content: Buffer.from('fake'),
    tenant_name: null,
    attempts: 1,
  };

  describe('drain() → claimNext() + send()', () => {
    it('claims a due PENDING row and, on a successful upload, sets photo_variants.fs_file_id and marks the outbox row UPLOADED', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const dataSource = fakeDataSource({
        claimRows: [JOB_ROW],
        queryImpl: (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes('UPDATE photo_variants SET fs_file_id')) return [];
          if (sql.includes("SET status = 'UPLOADED'")) return [];
          return undefined;
        },
      });
      // `dataSource.transaction` is used by `send()` for the two UPDATEs —
      // a plain fake that just runs the callback with the same fake
      // dataSource is enough here, matching `print-item.service.spec.ts`'s
      // own fake-transaction convention for a service that never actually
      // needs real transactional isolation in a unit test.
      (dataSource as { transaction?: unknown }).transaction = (
        fn: (manager: unknown) => Promise<void>,
      ) => fn(dataSource);

      const fileStorage = {
        uploadRaw: jest.fn().mockResolvedValue({
          fileId: 'fs-file-1',
          virtualPath: 'zztest/1.jpg',
          status: 'UPLOADING',
        }),
      };

      const worker = new VariantUploadWorkerService(
        dataSource,
        fileStorage as never,
      );
      // onModuleInit's recovery UPDATE and pollScans' scan SELECT both hit
      // the generic `[]`/`[]` fallback branches above — irrelevant to this
      // test's assertions.
      await worker.drain();

      expect(fileStorage.uploadRaw).toHaveBeenCalledWith(
        expect.objectContaining({
          virtualPath: 'zztest/1.jpg',
          mimeType: 'image/jpeg',
          idempotencyKey: 'idem-1',
          visibility: 'public',
        }),
      );
      const variantUpdate = calls.find((c) =>
        c.sql.includes('UPDATE photo_variants SET fs_file_id'),
      );
      expect(variantUpdate?.params).toEqual([
        'variant-1',
        'fs-file-1',
        'zztest/1.jpg',
        'UPLOADING',
      ]);
      const outboxUpdate = calls.find((c) => c.sql.includes("'UPLOADED'"));
      expect(outboxUpdate?.params).toEqual(['outbox-1']);
    });

    it('a terminal (non-retryable) FsError marks the outbox row FAILED and cancels the upload quota hold — never leaves it PENDING for an infinite retry loop', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const dataSource = fakeDataSource({
        claimRows: [JOB_ROW],
        queryImpl: (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes("SET status = 'FAILED'")) return [];
          return undefined;
        },
      });
      const fileStorage = {
        uploadRaw: jest
          .fn()
          .mockRejectedValue(new FsError(404, 'NOT_FOUND', 'gone')),
        cancelUpload: jest.fn().mockResolvedValue(undefined),
      };

      const worker = new VariantUploadWorkerService(
        dataSource,
        fileStorage as never,
      );
      await worker.drain();

      expect(fileStorage.cancelUpload).toHaveBeenCalled();
      const failedUpdate = calls.find((c) => c.sql.includes("'FAILED'"));
      expect(failedUpdate?.params?.[0]).toBe('outbox-1');
    });

    it("a retryable FsError (e.g. 503) leaves the row PENDING with a backed-off next_retry_at, not FAILED — so a transient outage does not permanently strand a variant's bytes", async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const dataSource = fakeDataSource({
        claimRows: [JOB_ROW],
        queryImpl: (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes("SET status = 'PENDING'")) return [];
          return undefined;
        },
      });
      const fileStorage = {
        uploadRaw: jest
          .fn()
          .mockRejectedValue(new FsError(503, 'UNAVAILABLE', 'try again')),
      };

      const worker = new VariantUploadWorkerService(
        dataSource,
        fileStorage as never,
      );
      await worker.drain();

      const retryUpdate = calls.find((c) =>
        c.sql.includes("SET status = 'PENDING'"),
      );
      expect(retryUpdate?.params?.[0]).toBe('outbox-1');
      expect(retryUpdate?.params?.[2]).toBeInstanceOf(Date);
    });
  });

  describe('pollScans()', () => {
    it('clears local outbox content once fs-core confirms the file is READY', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const dataSource = fakeDataSource({
        claimRows: [],
        scanRows: [{ id: 'variant-1', fs_file_id: 'fs-file-1' }],
        queryImpl: (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes('UPDATE photo_variants SET fs_status')) return [];
          if (sql.includes("content = ''::bytea")) return [];
          return undefined;
        },
      });
      const fileStorage = {
        getFile: jest.fn().mockResolvedValue({ status: 'READY' }),
      };

      const worker = new VariantUploadWorkerService(
        dataSource,
        fileStorage as never,
      );
      await worker.drain();

      const statusUpdate = calls.find((c) =>
        c.sql.includes('UPDATE photo_variants SET fs_status'),
      );
      expect(statusUpdate?.params).toEqual(['variant-1', 'READY']);
      const contentClear = calls.find((c) => c.sql.includes('::bytea'));
      expect(contentClear?.params).toEqual(['variant-1']);
    });

    it('a non-retryable fs-core error (file purged) marks fs_status FAILED and stops polling it — but does NOT clear the local content, which is the only remaining copy', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const dataSource = fakeDataSource({
        claimRows: [],
        scanRows: [{ id: 'variant-1', fs_file_id: 'fs-file-1' }],
        queryImpl: (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes("fs_status = 'FAILED'")) return [];
          return undefined;
        },
      });
      const fileStorage = {
        getFile: jest
          .fn()
          .mockRejectedValue(new FsError(404, 'NOT_FOUND', 'purged')),
      };

      const worker = new VariantUploadWorkerService(
        dataSource,
        fileStorage as never,
      );
      await worker.drain();

      const failedUpdate = calls.find((c) =>
        c.sql.includes("fs_status = 'FAILED'"),
      );
      expect(failedUpdate?.params?.[0]).toBe('variant-1');
      expect(calls.some((c) => c.sql.includes('::bytea'))).toBe(false);
    });
  });
});
