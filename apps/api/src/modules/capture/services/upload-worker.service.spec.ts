import { FS_SERVER_CODES, FsError } from '@face/fs-client';
import { OUTBOX_MAX_RETRY_DELAY_SECONDS } from '../capture.constants';
import { computeNextRetryAt, UploadWorkerService } from './upload-worker.service';

/**
 * Pins the backoff math on its own, without a database - what broke in the
 * field was Postgres's server-side type inference for a parameterized
 * `make_interval(secs => $n)` call, not this arithmetic. Moving the
 * computation into JavaScript (see the doc comment on `computeNextRetryAt`)
 * removes that failure mode entirely; these tests exist to keep the
 * arithmetic itself honest going forward.
 */
describe('computeNextRetryAt', () => {
  const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

  test('doubles the delay with each attempt', () => {
    const first = computeNextRetryAt(1, NOW).getTime() - NOW;
    const second = computeNextRetryAt(2, NOW).getTime() - NOW;
    const third = computeNextRetryAt(3, NOW).getTime() - NOW;

    expect(first).toBe(2_000);
    expect(second).toBe(4_000);
    expect(third).toBe(8_000);
  });

  test('caps the delay rather than growing without bound', () => {
    // The exponent cap (8 doublings = 256s) binds before the 300s ceiling
    // does; the ceiling is the actual promise ("never waits longer than
    // this"), not something today's formula ever reaches on its own.
    const atCap = computeNextRetryAt(20, NOW).getTime() - NOW;
    expect(atCap).toBe(256_000);
    expect(atCap).toBeLessThanOrEqual(OUTBOX_MAX_RETRY_DELAY_SECONDS * 1000);
  });

  test('never produces a delay Postgres would reject', () => {
    // The bug this regresses: a malformed input reaching the database as
    // NaN/undefined, which `make_interval` rejected as "interval out of
    // range". A `Date` cannot be NaN-valued without `getTime()` itself
    // reporting it, so this is the whole class of failure, pinned shut.
    for (const attempts of [-5, 0, 1, 3, 8, 100, Number.NaN]) {
      const result = computeNextRetryAt(attempts, NOW);
      expect(Number.isFinite(result.getTime())).toBe(true);
      expect(result.getTime()).toBeGreaterThanOrEqual(NOW);
    }
  });

  test('a negative attempt count is treated as zero, not extrapolated', () => {
    expect(computeNextRetryAt(-3, NOW).getTime()).toBe(
      computeNextRetryAt(0, NOW).getTime(),
    );
  });
});

/**
 * A minimal `DataSource` stand-in - just enough of `.query()`/`.transaction()`
 * for `UploadWorkerService`'s raw-SQL calls, dispatched by matching a
 * substring of the statement text (the same shape every method under test
 * already uses, so a fixture keyed on SQL shape is far less brittle than one
 * keyed on call order). Every call is recorded so a test can assert exactly
 * what was asked for, not just what came back.
 */
class FakeDataSource {
  public readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly handlers: Array<{
      when: string;
      respond: (params: unknown[]) => unknown;
    }>,
  ) {}

  query = async (sql: string, params: unknown[] = []): Promise<unknown> => {
    this.calls.push({ sql, params });
    const handler = this.handlers.find((h) => sql.includes(h.when));
    return handler ? handler.respond(params) : undefined;
  };

  transaction = async <T>(
    cb: (manager: { query: FakeDataSource['query'] }) => Promise<T>,
  ): Promise<T> => cb({ query: this.query });
}

/**
 * Regression coverage for the live-confirmed 2026-09-10 bug (session
 * 508eab26-fe78-4823-9544-8d341751140f and two earlier same-student sessions
 * that afternoon, campaign 0f7ffff0-047b-4f62-b45f-8f9816064da9 /
 * bc456402-8daf-4987-a189-cb6fc14dd08f): `PhotoService.addDevicePhoto`'s flat
 * `students/<CCCD>/<stepId>-<attempt>.<ext>` virtual path collides across two
 * different sessions' outbox rows the moment a student is retaken to the same
 * attempt number twice - each row carries a different, session-scoped
 * `Idempotency-Key`, so fs-core's `POST /api/v1/files` correctly rejects the
 * second one with `409 ALREADY_REGISTERED` instead of silently overwriting.
 * `resolvePathConflict()` (reached only through the private `send()`, called
 * here via a cast the same way this file already reaches `computeNextRetryAt`
 * as a plain function) is what turns that into the overwrite the product
 * actually wants, via `updateContent` rather than a second `POST`.
 */
describe('UploadWorkerService — ALREADY_REGISTERED conflict resolution', () => {
  const job = {
    id: 'outbox-row-2',
    photo_id: 'photo-session-2',
    idem_key: 'session-2:step-1-LEFT:2',
    virtual_path: 'students/014203003990/step-1-LEFT-2.jpg',
    mime_type: 'image/jpeg',
    content: Buffer.from('new retake bytes'),
    attempts: 1,
    visibility: 'private' as const,
  };

  const alreadyRegistered = () =>
    new FsError(
      409,
      FS_SERVER_CODES.ALREADY_REGISTERED,
      'file-service 409 ALREADY_REGISTERED: Đã tồn tại file ở đường dẫn này',
    );

  test('overwrites the prior occupant instead of failing when one is on file', async () => {
    const uploadRaw = jest.fn().mockRejectedValue(alreadyRegistered());
    const updateContent = jest.fn().mockResolvedValue({
      fileId: 'fs-file-from-session-1',
      version: 2,
      etag: 'etag-v2',
      size: job.content.byteLength,
      dedupHit: false,
      snapshot: true,
      unchanged: false,
    });
    const cancelUpload = jest.fn().mockResolvedValue(undefined);

    const dataSource = new FakeDataSource([
      {
        // resolvePathConflict()'s lookup - an EARLIER session's photo already
        // registered this exact virtual_path.
        when: 'SELECT p.fs_file_id, p.fs_etag',
        respond: () => [
          { fs_file_id: 'fs-file-from-session-1', fs_etag: 'etag-v1' },
        ],
      },
    ]);

    const service = new UploadWorkerService(
      dataSource as never,
      { uploadRaw, updateContent, cancelUpload } as never,
    );

    await (service as unknown as { send(job: unknown): Promise<void> }).send(
      job,
    );

    // The overwrite went to the SAME file the earlier session registered,
    // using ITS etag - not a second, competing create.
    expect(updateContent).toHaveBeenCalledWith('fs-file-from-session-1', {
      etag: 'etag-v1',
      data: new Uint8Array(job.content),
      mimeType: job.mime_type,
    });
    // Never falls back to the terminal failure path once the conflict is
    // actually resolved.
    expect(cancelUpload).not.toHaveBeenCalled();

    const outboxUpdate = dataSource.calls.find((c) =>
      c.sql.includes('UPDATE upload_outbox') && c.sql.includes("'UPLOADED'"),
    );
    expect(outboxUpdate?.params).toEqual([job.id]);

    const photoUpdate = dataSource.calls.find((c) =>
      c.sql.includes('UPDATE photos') && c.sql.includes('fs_file_id'),
    );
    expect(photoUpdate?.params).toEqual([
      job.photo_id,
      'fs-file-from-session-1',
      'etag-v2',
      'SCANNING',
      job.virtual_path,
    ]);

    // Never left FAILED anywhere along the way.
    expect(
      dataSource.calls.some((c) => c.sql.includes("status = 'FAILED'")),
    ).toBe(false);
  });

  test('falls through to the normal terminal failure when no prior occupant is on file', async () => {
    const err = alreadyRegistered();
    const uploadRaw = jest.fn().mockRejectedValue(err);
    const updateContent = jest.fn();
    const cancelUpload = jest.fn().mockResolvedValue(undefined);

    const dataSource = new FakeDataSource([
      { when: 'SELECT p.fs_file_id, p.fs_etag', respond: () => [] },
    ]);

    const service = new UploadWorkerService(
      dataSource as never,
      { uploadRaw, updateContent, cancelUpload } as never,
    );

    await (service as unknown as { send(job: unknown): Promise<void> }).send(
      job,
    );

    // Nothing on file to safely resolve against - must not invent a target
    // to overwrite.
    expect(updateContent).not.toHaveBeenCalled();
    expect(cancelUpload).toHaveBeenCalledWith(expect.any(String));

    const failedUpdate = dataSource.calls.find((c) =>
      c.sql.includes('UPDATE upload_outbox') && c.sql.includes("'FAILED'"),
    );
    expect(failedUpdate?.params).toEqual([job.id, err.message.slice(0, 500)]);
  });

  test('a normal (non-conflicting) upload is unaffected', async () => {
    const uploadRaw = jest.fn().mockResolvedValue({
      fileId: 'fs-file-fresh',
      virtualPath: job.virtual_path,
      status: 'SCANNING',
      size: job.content.byteLength,
      etag: 'etag-fresh',
      version: 1,
      dedupHit: false,
      visibility: 'private',
    });
    const updateContent = jest.fn();
    const cancelUpload = jest.fn();

    const dataSource = new FakeDataSource([]);

    const service = new UploadWorkerService(
      dataSource as never,
      { uploadRaw, updateContent, cancelUpload } as never,
    );

    await (service as unknown as { send(job: unknown): Promise<void> }).send(
      job,
    );

    expect(updateContent).not.toHaveBeenCalled();
    expect(cancelUpload).not.toHaveBeenCalled();
    // No conflict lookup issued at all on the happy path.
    expect(
      dataSource.calls.some((c) => c.sql.includes('SELECT p.fs_file_id')),
    ).toBe(false);

    const outboxUpdate = dataSource.calls.find((c) =>
      c.sql.includes('UPDATE upload_outbox') && c.sql.includes("'UPLOADED'"),
    );
    expect(outboxUpdate?.params).toEqual([job.id]);
  });
});
