import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { FsError, deterministicUuid } from '@face/fs-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VARIANT_OUTBOX_MAX_RETRY_DELAY_SECONDS } from '../photo-review.constants';

interface VariantOutboxRow {
  id: string;
  variant_id: string;
  idem_key: string;
  virtual_path: string;
  mime_type: string;
  content: Buffer;
  tenant_name: string | null;
  attempts: number;
}

interface ScanningVariantRow {
  id: string;
  fs_file_id: string;
}

/**
 * Exponential backoff, capped — a straight duplicate of
 * `capture/services/upload-worker.service.ts`'s own `computeNextRetryAt`
 * (same reasoning in full there, including why it's computed here rather
 * than via Postgres's `make_interval`). Not imported from that module: this
 * one pure function is not worth pulling `capture` into this module's
 * dependency graph for — `PhotoReviewModule` has no structural dependency on
 * `CaptureModule` anywhere else (see `photo-review.module.ts`'s own doc
 * comment), and `CaptureModule` already imports `PhotoReviewModule` (for
 * `ensureSetForApprovedSession`) — importing the other way would be a cycle.
 */
export function computeVariantNextRetryAt(
  attempts: number,
  now: number = Date.now(),
): Date {
  const safeAttempts = Number.isFinite(attempts) ? attempts : 0;
  const exponent = Math.min(Math.max(safeAttempts, 0), 8);
  const delaySeconds = Math.min(
    VARIANT_OUTBOX_MAX_RETRY_DELAY_SECONDS,
    2 ** exponent,
  );
  return new Date(now + delaySeconds * 1000);
}

/**
 * Drains `variant_upload_outbox` to the file-service — the photo-review
 * module's own counterpart to `capture`'s `UploadWorkerService`, kept as a
 * sibling service rather than folded into that one (see this task's own
 * brief, "your call, justify it"):
 *
 *  1. **Module boundary**: `UploadWorkerService` lives in `CaptureModule`,
 *     which this module (`PhotoReviewModule`) must not import (see above) —
 *     teaching `UploadWorkerService` about `variant_upload_outbox` would
 *     work fine via raw SQL (no entity import needed), but would mean a
 *     capture-owned service also owning a photo-review-owned table's retry
 *     policy, spreading one table's ownership across two modules' source
 *     trees for no benefit.
 *  2. **Different upload semantics**: a variant upload is tenant-aware per
 *     row (`tenant_name` — see the migration's doc comment) where
 *     `UploadWorkerService.send()` always uses the default tenant; a variant
 *     row has no `approved_at` gate (nothing upstream of "the reviewer
 *     triggered reprocess/AI-edit/upload" needs to approve it) where every
 *     row `UploadWorkerService.claimNext()` picks up is gated on one.
 *     Bolting both differences onto the existing query/loop as branches
 *     would leave two case statements every read of that file has to hold
 *     in mind, for two tables that otherwise share nothing but their shape.
 *
 * `pollScans()` (2026-09-09 fix, paired with `send()`'s own comment and
 * migration `1806000000000-PhotoVariantFsStatus.ts`) is the variant
 * counterpart of `UploadWorkerService.pollScans()`, for the exact same
 * reason: this module's own doc comment used to claim
 * `FileStorageService.issueViewLink`'s `client.waitUntilReady` made a
 * second poll unnecessary, but that only waits out a scan still in
 * progress AT THE MOMENT A VIEWER ASKS — it says nothing about a file this
 * real fs-core deployment purges AFTER accepting it and BEFORE any viewer
 * ever requests it, which is exactly what live data showed (a variant whose
 * `fs_file_id` had gone through `send()` well before anyone viewed it,
 * later confirmed 404 on a direct `getFile`). Without this method,
 * `photo_variants.fs_status` — which did not even exist before this same
 * fix — would never be set at all, and, more importantly, `send()`'s
 * now-preserved local content (see that method's own comment) would never
 * get cleared either, defeating half the point of tracking this in the
 * first place.
 */
@Injectable()
export class VariantUploadWorkerService implements OnModuleInit {
  private readonly logger = new Logger(VariantUploadWorkerService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Same "a process died mid-send" recovery as UploadWorkerService's own
    // onModuleInit — the upload is idempotent, so re-sending is safe and
    // leaving a row stuck in SENDING forever is not.
    await this.dataSource
      .query(
        `UPDATE variant_upload_outbox SET status = 'PENDING' WHERE status = 'SENDING'`,
      )
      .catch((err) =>
        this.logger.warn(
          `recoverInterrupted failed: ${(err as Error).message}`,
        ),
      );
  }

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
      this.logger.error(`tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Same `FOR UPDATE SKIP LOCKED` claim pattern as `UploadWorkerService.claimNext` — see that method's own doc comment for the `DataSource.query()` tuple-destructuring pitfall this already avoids. */
  private async claimNext(): Promise<VariantOutboxRow | null> {
    const [rows]: [VariantOutboxRow[], number] = await this.dataSource.query(
      `UPDATE variant_upload_outbox
          SET status = 'SENDING', attempts = attempts + 1
        WHERE id = (
          SELECT id FROM variant_upload_outbox
           WHERE status = 'PENDING' AND next_retry_at <= now()
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, variant_id, idem_key, virtual_path, mime_type, content, tenant_name, attempts`,
    );
    return rows[0] ?? null;
  }

  /**
   * `variant_upload_outbox.content` stays put here — 2026-09-09 fix, paired
   * with `pollScans()` below (same reasoning in full as
   * `UploadWorkerService.send()`'s own comment, which this mirrors). A
   * successful `uploadRaw` response only means "the file-service accepted
   * the bytes," not "the file survived its own virus-scan" — this real
   * fs-core deployment has been observed purging a freshly-uploaded file
   * before ever marking it READY, and a specific variant
   * (`de2db48a-3563-45cd-b10e-cf1ba9e1e535`, `fs_file_id =
   * 'be9e9fb0-c9a9-4ace-8875-1918f777d7df'`) is already stuck in exactly
   * that state: `fs_file_id` set, but `getFile` now 404s and — because this
   * method used to clear `content` right here, before this fix — there is
   * no recoverable copy anywhere for that specific row. `pollScans` is now
   * the only place that ever clears `content`, and only once the file has
   * actually reached `READY`.
   */
  private async send(job: VariantOutboxRow): Promise<void> {
    try {
      const uploadInput = {
        virtualPath: job.virtual_path,
        mimeType: job.mime_type,
        data: new Uint8Array(job.content),
        idempotencyKey: job.idem_key,
        visibility: 'private' as const,
      };
      const result = job.tenant_name
        ? await (await this.fileStorage.clientForTenant(job.tenant_name)).uploadRaw(uploadInput)
        : await this.fileStorage.uploadRaw(uploadInput);

      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE photo_variants SET fs_file_id = $2, virtual_path = $3, fs_status = $4 WHERE id = $1`,
          [job.variant_id, result.fileId, result.virtualPath, result.status],
        );
        await manager.query(
          `UPDATE variant_upload_outbox
              SET status = 'UPLOADED', last_error = NULL
            WHERE id = $1`,
          [job.id],
        );
      });
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  /**
   * Advance variants whose bytes are already on the file-service but which
   * are still being scanned there — the variant counterpart of
   * `UploadWorkerService.pollScans()` (see that method's own doc comment
   * for the full live-confirmed 404 story this mirrors exactly, and this
   * class's own top doc comment for why a second poll is needed even though
   * `FileStorageService.issueViewLink` already waits out an in-progress
   * scan).
   *
   * Same terminal-vs-transient split as `recordFailure` below: a retryable
   * `FsError` (network hiccup, 5xx, rate limit) is logged and left alone for
   * the next tick; a non-retryable one (most commonly `NOT_FOUND`, once the
   * scan pipeline has actually purged the file) marks `fs_status = 'FAILED'`
   * so this row stops being polled and — critically — so
   * `PhotoReviewService.resolveVariantViewSource`/`resolveCurrentCardViewUrl`
   * stop trusting `fsFileId`. `variant_upload_outbox.content` is left
   * completely untouched on that path — it was never cleared until this
   * exact confirmation was reached, so it is the one thing that lets a
   * viewer still see this variant's image at all once fs-core has discarded
   * its own copy.
   */
  private async pollScans(): Promise<void> {
    const rows: ScanningVariantRow[] = await this.dataSource.query(
      `SELECT id, fs_file_id
         FROM photo_variants
        WHERE fs_file_id IS NOT NULL
          AND fs_status IN ('UPLOADING', 'SCANNING', 'SCAN_PENDING')
        ORDER BY updated_at ASC
        LIMIT 20`,
    );

    for (const row of rows) {
      try {
        const info = await this.fileStorage.getFile(row.fs_file_id);
        // Written unconditionally, including "still scanning" states — same
        // reasoning as UploadWorkerService.pollScans()'s own unconditional
        // write.
        await this.dataSource.query(
          `UPDATE photo_variants SET fs_status = $2 WHERE id = $1`,
          [row.id, info.status],
        );
        if (info.status === 'READY') {
          await this.dataSource.query(
            `UPDATE variant_upload_outbox SET content = ''::bytea WHERE variant_id = $1`,
            [row.id],
          );
        }
      } catch (err) {
        const fsErr = err instanceof FsError ? err : null;
        if (fsErr && !fsErr.retryable) {
          await this.dataSource.query(
            `UPDATE photo_variants SET fs_status = 'FAILED', fs_upload_error = $2 WHERE id = $1`,
            [row.id, fsErr.message.slice(0, 500)],
          );
          continue;
        }
        // A transient failure is not a reason to touch a row that hasn't
        // actually changed state — the next tick tries again.
        this.logger.warn(
          `pollScans failed for variant ${row.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async recordFailure(job: VariantOutboxRow, err: unknown): Promise<void> {
    if (!job?.id) {
      this.logger.error('recordFailure called with no job id - skipping');
      return;
    }

    const fsErr = err instanceof FsError ? err : null;
    const message = ((err as Error)?.message ?? String(err)).slice(0, 500);
    const terminal = fsErr !== null && !fsErr.retryable;

    if (terminal) {
      await this.fileStorage
        .cancelUpload(deterministicUuid(job.idem_key))
        .catch(() => undefined);

      await this.dataSource.query(
        `UPDATE variant_upload_outbox SET status = 'FAILED', last_error = $2 WHERE id = $1`,
        [job.id, message],
      );
      return;
    }

    await this.dataSource.query(
      `UPDATE variant_upload_outbox
          SET status = 'PENDING', last_error = $2, next_retry_at = $3
        WHERE id = $1`,
      [job.id, message, computeVariantNextRetryAt(job.attempts)],
    );
  }
}
