import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import type { Visibility } from '@face/core';
import { FS_SERVER_CODES, FsError, deterministicUuid } from '@face/fs-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OUTBOX_MAX_RETRY_DELAY_SECONDS, PURGE_RETRY_MAX_ATTEMPTS } from '../capture.constants';

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
   * Recovers photos the file-service silently purged after already
   * accepting them (2026-09-10, "sau file server hoạt động lại sẽ không
   * đẩy lại sao?" — asked about the OTHER outage case, transport failures,
   * which `recordFailure` already retries forever; this is the one that
   * genuinely had no recovery). Distinct from `drain()`'s own fast 3s loop,
   * which only ever claims rows still `PENDING` (never attempted, or a
   * transient `send()` failure already being retried there) — a row that
   * DID succeed once (`upload_outbox.status = 'UPLOADED'`) is permanently
   * outside that loop's reach, even after `pollScans()` later confirms via
   * a terminal 404 that the file-service no longer has it
   * (`photos.fs_status = 'FAILED'`).
   *
   * Runs on its own slower cadence (30s, not 3s) — recovering from a purge
   * isn't as time-sensitive as draining a fresh queue, and re-attempting
   * this fast would mostly just re-observe the same purge before the
   * file-service's own scan has even finished.
   *
   * Re-queues by flipping the outbox row back to `PENDING` — `claimNext()`/
   * `send()` then handle the actual re-upload exactly as they would any
   * other pending job. `photos.fs_file_id`/`fs_etag`/`fs_status` are
   * deliberately left untouched here (an earlier version of this method
   * cleared them — wrong, caught live 2026-09-10 verifying this exact fix):
   * a fresh POST after a purge reliably comes back `409 ALREADY_REGISTERED`
   * (the file-service still has the path registered even though the bytes
   * are gone), and `resolvePathConflict()`'s only way to resolve that is by
   * looking up the row's OWN existing `fs_file_id`/`fs_etag` to overwrite
   * via `updateContent()` — clearing them first leaves it nothing to find,
   * so the conflict falls through to a terminal `recordFailure()` instead of
   * actually recovering. Leaving `fs_status = 'FAILED'` in place during the
   * retry window is also harmless (not just safe): `resolveViewSource`
   * already refuses to trust a remote link while `fsStatus === 'FAILED'`,
   * so local-content fallback keeps working regardless — nothing here needs
   * to change for that.
   *
   * `attempts < PURGE_RETRY_MAX_ATTEMPTS` caps this — `claimNext()`
   * increments `attempts` on every claim regardless of why a row became
   * eligible again, so the same counter naturally covers both the original
   * send and every purge-recovery retry. A row that keeps getting purged
   * past that cap is left `UPLOADED`/`FAILED` for good, still safely
   * viewable from local content, rather than retried forever.
   */
  private async retryPurgedUploads(): Promise<void> {
    // `idem_key` gets a fresh, never-before-used suffix on every requeue —
    // live-confirmed necessary (2026-09-10): retrying with the ORIGINAL
    // idem_key unchanged got back the exact same fs_file_id as the purged
    // upload and was FAILED again within seconds, far too fast for a genuine
    // fresh scan-then-purge cycle. The file-service's own idempotency
    // handling evidently keys off this header and replies from its own
    // memory of the original (now-dead) upload rather than accepting fresh
    // bytes — so a real retry needs a key it has never seen, not a repeat of
    // one it thinks it already handled. `o.attempts` is already a
    // monotonically increasing counter (claimNext increments it on every
    // claim), so appending it guarantees each requeue's key is new.
    const [, requeued]: [unknown[], number] = await this.dataSource.query(
      `UPDATE upload_outbox o
          SET status = 'PENDING',
              next_retry_at = now(),
              last_error = NULL,
              idem_key = o.idem_key || ':purge-retry-' || o.attempts::text
         FROM photos p
        WHERE o.photo_id = p.id
          AND o.status = 'UPLOADED'
          AND p.fs_status = 'FAILED'
          AND o.content IS NOT NULL AND length(o.content) > 0
          AND o.attempts < $1`,
      [PURGE_RETRY_MAX_ATTEMPTS],
    );
    if (requeued > 0) {
      this.logger.log(`retryPurgedUploads: re-queued ${requeued} purged photo(s) for re-upload`);
    }
  }

  @Cron('*/30 * * * * *')
  async drainPurgeRecovery(): Promise<void> {
    try {
      await this.retryPurgedUploads();
    } catch (err) {
      this.logger.error(`drainPurgeRecovery tick failed: ${(err as Error).message}`);
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

      await this.applyUploadSuccess(job, result);
    } catch (err) {
      if (err instanceof FsError && err.code === FS_SERVER_CODES.ALREADY_REGISTERED) {
        // See resolvePathConflict()'s own doc comment for the live-confirmed
        // root cause this handles - a kiosk retake landing on a flat,
        // session-agnostic virtual path an EARLIER session already
        // registered under a different Idempotency-Key. Only reached for
        // this one error code, so a genuinely unexpected ALREADY_REGISTERED
        // (someone else's file, no local record of it at all) still falls
        // straight through to the same terminal recordFailure() as before.
        if (await this.resolvePathConflict(job, err)) return;
      }
      await this.recordFailure(job, err);
    }
  }

  /**
   * Persists a successful upload onto `photos`/`upload_outbox` — the same
   * write whether the bytes were accepted by a fresh `POST` (the normal
   * `send()` path) or landed via `resolvePathConflict()`'s in-place
   * `updateContent()` overwrite, so both paths get the exact same
   * "content stays put until pollScans confirms READY" guarantee.
   */
  private async applyUploadSuccess(
    job: OutboxRow,
    result: { fileId: string; etag: string; status: string; virtualPath: string },
  ): Promise<void> {
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
  }

  /**
   * Resolves an `ALREADY_REGISTERED` (409) conflict on `job.virtual_path` by
   * overwriting the file that already occupies it, instead of leaving the
   * job FAILED forever.
   *
   * Live-confirmed root cause (2026-09-10, session 508eab26-fe78-4823-9544-
   * 8d341751140f, student CCCD 014203003990 — and the same student's two
   * EARLIER sessions that afternoon, a65f0f08... and fea0df3f..., hit the
   * identical conflict): `PhotoService.addDevicePhoto()` deliberately builds
   * a FLAT, session-agnostic virtual path for a kiosk photo —
   * `students/<CCCD>/<stepId>-<attempt>.<ext>`, no session segment, so a
   * student's whole capture history lands under one folder (see that
   * method's own doc comment: "accepted deliberately here, not an
   * oversight"). But `job.idem_key` (this row's `Idempotency-Key`) is scoped
   * PER SESSION (`${sessionId}:${stepId}:${attempt}`) — so the SAME
   * `(stepId, attempt)` recurring for the SAME student across two DIFFERENT
   * sessions (an ordinary retake pattern: an operator very often retakes a
   * step exactly once, landing on attempt 2 session after session) produces
   * the exact same virtual path with a genuinely different Idempotency-Key
   * each time. fs-core keys `virtual_path` uniqueness AHEAD of the
   * idempotency check: a repeat `POST` with a key other than the one the
   * existing file was created under is correctly rejected as a new,
   * conflicting create — never silently treated as an update — which is the
   * `409 ALREADY_REGISTERED` observed live for exactly this pattern, three
   * times in one afternoon for this one student's `step-1-LEFT-2`/
   * `step-2-RIGHT-2` paths (`attempts: 1` on every one of those rows — a
   * single first request, not a self-inflicted duplicate from a retry loop
   * here or in `FsClient`, which retries nothing on its own).
   *
   * The product intent behind the flat path ("student's own folder, latest
   * capture wins" — see `addDevicePhoto`'s own comment) is real, so the fix
   * is to actually perform that overwrite through the mechanism fs-core
   * provides for it — `PUT` a new version onto the file already there
   * (`FileStorageService.updateContent`) — rather than only ever attempting
   * `POST` (create), which fs-core will never silently turn into an update.
   *
   * The prior occupant is looked up via `upload_outbox.virtual_path` (what
   * THIS worker itself sent to fs-core), never `photos.virtual_path` alone —
   * that column can be, and here was, stale: a late-arriving legacy
   * `SESSION_REPORT` device-event (still emitted by every kiosk build
   * alongside the newer direct `POST /v1/devices/photos` push) overwrites it
   * with the kiosk's own local `face/<year>/<sessionId>/...` queue path (see
   * `CaptureReportService.applySessionReport`'s unconditional
   * `virtual_path = EXCLUDED.virtual_path`) — a separate, real bug in its
   * own right, but not the cause of this conflict and out of this fix's
   * scope; `upload_outbox.virtual_path` is never touched by that path and
   * stays accurate throughout.
   *
   * Returns true once the conflict is fully handled — either resolved
   * (outbox row marked UPLOADED, photo row updated) or recorded as a normal
   * failure on the follow-up attempt's own merits — false only when there is
   * no prior occupant on file to explain the conflict, in which case the
   * caller falls through to the original, unresolved 409.
   */
  private async resolvePathConflict(
    job: OutboxRow,
    originalErr: FsError,
  ): Promise<boolean> {
    const prior: Array<{ fs_file_id: string; fs_etag: string | null }> =
      await this.dataSource.query(
        `SELECT p.fs_file_id, p.fs_etag
           FROM upload_outbox o
           JOIN photos p ON p.id = o.photo_id
          WHERE o.virtual_path = $1
            AND o.photo_id != $2
            AND p.fs_file_id IS NOT NULL
          ORDER BY o.created_at DESC
          LIMIT 1`,
        [job.virtual_path, job.photo_id],
      );

    const occupant = prior[0];
    if (!occupant?.fs_file_id || !occupant.fs_etag) {
      // Nothing on file explains the conflict (a different tenant's file, or
      // a prior occupant this API never recorded an etag for) — not
      // something this can safely resolve. Left as the original 409,
      // terminal exactly as before this fix.
      this.logger.warn(
        `ALREADY_REGISTERED for "${job.virtual_path}" (job ${job.id}): no prior occupant on file — ${originalErr.message}`,
      );
      return false;
    }

    try {
      const updated = await this.fileStorage.updateContent(occupant.fs_file_id, {
        etag: occupant.fs_etag,
        data: new Uint8Array(job.content),
        mimeType: job.mime_type,
      });
      // `updateContent` reports no `status` of its own (unlike a fresh
      // upload's response) — a new version goes through the same
      // virus-scan pipeline a create does, so this is provisional exactly
      // the way a create's own `SCANNING` response is: `pollScans()`
      // corrects it to READY/FAILED on its own next tick once it learns the
      // real state from `getFile()`.
      await this.applyUploadSuccess(job, {
        fileId: occupant.fs_file_id,
        etag: updated.etag,
        status: 'SCANNING',
        virtualPath: job.virtual_path,
      });
      this.logger.log(
        `resolved ALREADY_REGISTERED for "${job.virtual_path}" (job ${job.id}) by overwriting prior file ${occupant.fs_file_id}`,
      );
      return true;
    } catch (updateErr) {
      // The follow-up write failed on ITS OWN merits (a stale local etag
      // because fs-core's copy moved on independently, a transient 5xx, ...)
      // — judged by the normal retryable/terminal split via recordFailure(),
      // not blindly inherited from the original 409 (which is always
      // terminal, even when this secondary failure is actually transient).
      // Live-observed case (2026-09-10, verifying this very fix): the
      // occupant found above had ALREADY been purged by fs-core's own
      // separate, already-known virus-scan-purge pipeline in the seconds
      // between upload and this resolve attempt, so the PUT itself answers
      // 404 NOT_FOUND — logged here specifically so that outcome reads as
      // "conflict resolution attempted, target vanished out from under it"
      // rather than as an unrelated, unexplained failure.
      this.logger.warn(
        `ALREADY_REGISTERED for "${job.virtual_path}" (job ${job.id}): found prior occupant ${occupant.fs_file_id} but overwriting it also failed — ${(updateErr as Error)?.message ?? String(updateErr)}`,
      );
      await this.recordFailure(job, updateErr);
      return true;
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
