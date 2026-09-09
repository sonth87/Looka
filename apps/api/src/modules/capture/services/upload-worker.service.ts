import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import type { Visibility } from '@face/core';
import { FsError, deterministicUuid } from '@face/fs-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OUTBOX_MAX_RETRY_DELAY_SECONDS } from '../capture.constants';

interface OutboxRow {
  id: string;
  photo_id: string;
  idem_key: string;
  virtual_path: string;
  mime_type: string;
  content: Buffer;
  attempts: number;
  visibility: Visibility | null;
}

interface ScanningPhotoRow {
  id: string;
  fs_file_id: string;
}

/**
 * Exponential backoff, capped, computed here rather than via Postgres's
 * `now() + make_interval(secs => $n)`.
 *
 * Not just a style choice: `make_interval` takes a NAMED argument with the
 * other six defaulted, and a parameterized `$n` in that position is exactly
 * the case where Postgres's server-side type inference for extended-query
 * placeholders is least reliable - this is what produced "interval out of
 * range" for what was, in JavaScript, an ordinary small integer. Passing a
 * `Date` for a `timestamptz` column sidesteps that inference entirely: `pg`
 * serializes it as a literal timestamp, nothing left for the server to guess.
 *
 * A free function, not a method, so it is testable without constructing the
 * service's DataSource/FileStorageService dependencies.
 */
export function computeNextRetryAt(
  attempts: number,
  now: number = Date.now(),
): Date {
  // `Math.max`/`Math.min` propagate NaN rather than clamping it - a NaN or
  // otherwise non-finite `attempts` (a malformed row, a coercion gone wrong
  // somewhere upstream) would otherwise flow straight through into a NaN
  // delay and an Invalid Date, silently corrupting the row `dataSource.query`
  // then tries to persist. This is the exact class of bug being closed here,
  // so it is sanitised before anything else touches it.
  const safeAttempts = Number.isFinite(attempts) ? attempts : 0;
  // Capped at 8 doublings (256s), comfortably under the 300s ceiling below -
  // the ceiling exists as the actual promise ("nothing waits longer than
  // this"), the exponent cap as how it is reached in practice; raising the
  // exponent cap alone would let it, so both stay explicit rather than
  // collapsing into just whichever one happens to bind today.
  const exponent = Math.min(Math.max(safeAttempts, 0), 8);
  const delaySeconds = Math.min(OUTBOX_MAX_RETRY_DELAY_SECONDS, 2 ** exponent);
  return new Date(now + delaySeconds * 1000);
}

/**
 * Drains queued captures to the file-service.
 *
 * Runs behind the request that created them: a browser waiting on a virus
 * scan would time out long before the file was readable, and an upload that
 * fails should delay a photo rather than lose the request that produced it.
 * Same job as the reference CMS's `SchedulerService` cron methods, scoped to
 * this one queue.
 */
@Injectable()
export class UploadWorkerService implements OnModuleInit {
  private readonly logger = new Logger(UploadWorkerService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Anything left SENDING belongs to a process that died mid-flight. The
    // upload is idempotent, so re-sending is safe and leaving it stuck is not.
    await this.dataSource
      .query(
        `UPDATE upload_outbox SET status = 'PENDING' WHERE status = 'SENDING'`,
      )
      .catch((err) =>
        this.logger.warn(
          `recoverInterrupted failed: ${(err as Error).message}`,
        ),
      );
  }

  // `CronExpression` only names 30s/45s and up as its finest steps; a queue an
  // operator is standing in front of needs a tighter poll than that.
  @Cron('*/3 * * * * *')
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = await this.claimNext();
        if (!job) break;
        await this.send(job);
      }
      await this.pollScans();
    } catch (err) {
      // A background drain must never take the process down. The queue is
      // durable, so whatever went wrong here is retried on the next tick;
      // an uncaught error here would stop the API accepting captures it
      // could still have stored.
      this.logger.error(`tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Take one job, marking it SENDING in the same statement. `FOR UPDATE SKIP
   * LOCKED` lets a second replica work the queue at the same time without
   * either of them picking up a row the other already holds - not expressible
   * through TypeORM's query builder, so this stays raw SQL.
   *
   * `DataSource.query()` (unlike `EntityManager.query()` inside a
   * transaction - see PhotoService.addPhoto's INSERT ... RETURNING) returns
   * `[rows, affectedCount]` for a non-SELECT statement with RETURNING, not a
   * flat rows array. Destructuring straight into `rows` used to bind the
   * WHOLE TUPLE to that name: `rows[0]` was the inner rows array itself
   * (still truthy with zero rows claimed, so the caller's drain loop never
   * saw `null` and span forever), and every real row's fields read as
   * undefined off it. Confirmed against a live DataSource before fixing -
   * this codepath had never actually been run end-to-end before.
   */
  private async claimNext(): Promise<OutboxRow | null> {
    const [rows]: [OutboxRow[], number] = await this.dataSource.query(
      `UPDATE upload_outbox
          SET status = 'SENDING', attempts = attempts + 1
        WHERE id = (
          SELECT id FROM upload_outbox
           WHERE status = 'PENDING' AND next_retry_at <= now() AND approved_at IS NOT NULL
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, photo_id, idem_key, virtual_path, mime_type, content, attempts, visibility`,
    );
    return rows[0] ?? null;
  }

  /**
   * Advance photos whose bytes are already on the file-service but which are
   * still being scanned there.
   *
   * `send()` only records the status the upload response carried at that
   * instant (typically SCANNING); nothing else in this service ever looks at
   * a file again afterwards, so without this a photo can sit at SCANNING
   * forever even once the server has finished. apps/desktop's `UploadWorker`
   * has the same second stage (`pollScans`) for the same reason.
   *
   * Two failure modes matter differently here, distinguished the same way
   * `recordFailure` below already distinguishes them for `send()` (via
   * `FsError.retryable`):
   *
   *  - Transient (network hiccup, 5xx, rate limit) — logged and left alone;
   *    the row's status hasn't actually changed, and the next tick tries
   *    again.
   *  - Terminal (a plain 4xx — most commonly `NOT_FOUND`) — the file is
   *    gone and will never become READY, so the row is marked `FAILED`
   *    rather than left showing its last known status forever. Confirmed
   *    live (2026-09-09): a freshly uploaded diagnostic file answered
   *    `getFile` with `SCAN_PENDING` seconds after upload, then `NOT_FOUND`
   *    shortly after that — this real fs-core deployment's own scan
   *    pipeline purged it before ever marking it READY. Before this fix,
   *    that same 404 was silently swallowed here every 3 seconds forever,
   *    which is the exact "stuck on SCANNING" symptom this method exists to
   *    prevent — just for a file that was never coming back, rather than
   *    one that just hadn't finished yet. `FsClient.getFile` itself now
   *    absorbs the OTHER live-confirmed surprise — a `SCAN_PENDING` file
   *    answering with `423` instead of a normal `200` + status body — so a
   *    genuinely-still-scanning file no longer even reaches this catch
   *    block; see that method's own doc comment.
   *
   * `upload_outbox.content` (2026-09-09 fix, paired with `send()`'s own
   * comment) is only ever cleared here, and only once `info.status ===
   * 'READY'` confirms the file genuinely survived — never on a terminal
   * `FAILED`, so a photo this real fs-core deployment purges mid-scan still
   * has a durable, servable local copy forever instead of becoming
   * unviewable everywhere.
   */
  private async pollScans(): Promise<void> {
    const rows: ScanningPhotoRow[] = await this.dataSource.query(
      `SELECT id, fs_file_id
         FROM photos
        WHERE fs_file_id IS NOT NULL
          AND fs_status IN ('UPLOADING', 'SCANNING', 'SCAN_PENDING')
        ORDER BY updated_at ASC
        LIMIT 20`,
    );

    for (const row of rows) {
      try {
        const info = await this.fileStorage.getFile(row.fs_file_id);
        // Written unconditionally, including "still scanning" states: the
        // server can move SCAN_PENDING -> SCANNING before landing on READY,
        // and there is no cheaper way to tell that apart from "unchanged"
        // without also fetching the row's current fs_status up front.
        await this.dataSource.query(
          `UPDATE photos SET fs_status = $2 WHERE id = $1`,
          [row.id, info.status],
        );
        if (info.status === 'READY') {
          await this.dataSource.query(
            `UPDATE upload_outbox SET status = 'DONE', content = ''::bytea WHERE photo_id = $1`,
            [row.id],
          );
        }
      } catch (err) {
        const fsErr = err instanceof FsError ? err : null;
        if (fsErr && !fsErr.retryable) {
          await this.dataSource.query(
            `UPDATE photos SET fs_status = 'FAILED', upload_error = $2 WHERE id = $1`,
            [row.id, fsErr.message.slice(0, 500)],
          );
          continue;
        }
        // A transient failure (network hiccup, 5xx, rate limit) is not a
        // reason to touch a row that hasn't actually changed state -
        // the next tick tries again.
        this.logger.warn(
          `pollScans failed for photo ${row.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async send(job: OutboxRow): Promise<void> {
    try {
      const result = await this.fileStorage.uploadRaw({
        virtualPath: job.virtual_path,
        mimeType: job.mime_type,
        data: new Uint8Array(job.content),
        idempotencyKey: job.idem_key,
        // Carried through from the row, not decided here — see PhotoService
        // where the outbox row is written and this value is actually chosen.
        visibility: job.visibility ?? undefined,
      });

      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE photos
              SET fs_file_id = $2, fs_etag = $3, fs_status = $4, virtual_path = $5
            WHERE id = $1`,
          [
            job.photo_id,
            result.fileId,
            result.etag,
            result.status,
            result.virtualPath,
          ],
        );
        // `content` stays put here — 2026-09-09 fix. This used to be cleared
        // the instant the upload response came back (`status: 'UPLOADED'`
        // only means "the file-service accepted the bytes," not "the file
        // actually survived its own virus scan"). Live-confirmed the same
        // day (see `pollScans`'s own doc comment): this real fs-core
        // deployment's scan pipeline can purge a freshly-uploaded file
        // before ever marking it READY, which `pollScans` correctly detects
        // and marks `photos.fs_status = 'FAILED'` for — but with content
        // already gone at that point, the photo became permanently
        // unviewable everywhere (not on fs-core, not locally), the exact
        // "SCANNING forever" / "File server không phản hồi" field symptom
        // this whole fix chases. `pollScans` below is now the only place
        // that clears it, and only once the file has actually reached
        // `READY` — see that method's own comment.
        await manager.query(
          `UPDATE upload_outbox
              SET status = 'UPLOADED', last_error = NULL
            WHERE id = $1`,
          [job.id],
        );
      });
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  private async recordFailure(job: OutboxRow, err: unknown): Promise<void> {
    if (!job?.id) {
      // Defensive only: claimNext's RETURNING guarantees an id on every row
      // it hands back, so this should be unreachable. Guarded anyway because
      // silently issuing `WHERE id = NULL` (matches nothing, updates nothing,
      // throws nothing) would leave a row stuck in SENDING forever with no
      // trace of why.
      this.logger.error('recordFailure called with no job id - skipping');
      return;
    }

    const fsErr = err instanceof FsError ? err : null;
    const message = ((err as Error)?.message ?? String(err)).slice(0, 500);

    // A rejected request will be rejected identically forever; repeating it
    // only delays the point at which somebody notices something needs fixing.
    const terminal = fsErr !== null && !fsErr.retryable;

    if (terminal) {
      // Best-effort: if this job ever went chunked, the server holds a
      // session (and the quota it reserved) under the uploadId derived the
      // same way FsClient derives it internally. Releasing it here means the
      // tenant isn't charged for it until the session times out on its own.
      // A cancel failing (no session ever existed, network down) must not
      // block marking the row FAILED - that would leave it stuck SENDING.
      await this.fileStorage
        .cancelUpload(deterministicUuid(job.idem_key))
        .catch(() => undefined);

      await this.dataSource.query(
        `UPDATE upload_outbox SET status = 'FAILED', last_error = $2 WHERE id = $1`,
        [job.id, message],
      );
      return;
    }

    await this.dataSource.query(
      `UPDATE upload_outbox
          SET status = 'PENDING', last_error = $2, next_retry_at = $3
        WHERE id = $1`,
      [job.id, message, computeNextRetryAt(job.attempts)],
    );
  }
}
