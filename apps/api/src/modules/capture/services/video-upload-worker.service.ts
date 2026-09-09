import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import type { Visibility } from '@face/core';
import { FsError, deterministicUuid } from '@face/fs-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { computeNextRetryAt } from './upload-worker.service';

interface VideoOutboxRow {
  id: string;
  video_id: string;
  idem_key: string;
  virtual_path: string;
  mime_type: string;
  content: Buffer;
  attempts: number;
  visibility: Visibility | null;
}

interface ScanningVideoRow {
  id: string;
  fs_file_id: string;
}

/**
 * Drains `video_upload_outbox` to fs-core — the exact video counterpart of
 * `UploadWorkerService`, added 2026-09-09 ("route kiosk VIDEO uploads
 * through apps/api the same way kiosk PHOTO uploads already work").
 *
 * A separate cron/class rather than a generalized "outbox worker" over both
 * tables: the two source tables have different FK columns (`photo_id` vs
 * `video_id`) and update different target tables (`photos` vs
 * `session_videos`) on success, so a shared implementation would need a
 * config object threading both column names through every query anyway —
 * no simpler than two small, independently readable classes, and safer to
 * land without risking the already-working photo path.
 *
 * `computeNextRetryAt` is reused as-is from `upload-worker.service.ts`
 * (exported from there) rather than duplicated — the backoff math has
 * nothing photo-specific about it.
 *
 * Both stages below already bake in the 2026-09-09 photo-pipeline fix from
 * the start (see this task's own brief: "don't reintroduce the
 * premature-clearing bug this was just fixed for") — `content` is only ever
 * cleared once `pollScans()` confirms a genuine `READY`, never on `send()`'s
 * own upload-accepted response and never on a terminal `FAILED`.
 */
@Injectable()
export class VideoUploadWorkerService implements OnModuleInit {
  private readonly logger = new Logger(VideoUploadWorkerService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Same interrupted-job recovery as UploadWorkerService.onModuleInit —
    // see that method's own doc comment.
    await this.dataSource
      .query(
        `UPDATE video_upload_outbox SET status = 'PENDING' WHERE status = 'SENDING'`,
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

  /** Same `FOR UPDATE SKIP LOCKED` claim as `UploadWorkerService.claimNext` — see that method's own doc comment. */
  private async claimNext(): Promise<VideoOutboxRow | null> {
    const [rows]: [VideoOutboxRow[], number] = await this.dataSource.query(
      `UPDATE video_upload_outbox
          SET status = 'SENDING', attempts = attempts + 1
        WHERE id = (
          SELECT id FROM video_upload_outbox
           WHERE status = 'PENDING' AND next_retry_at <= now() AND approved_at IS NOT NULL
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, video_id, idem_key, virtual_path, mime_type, content, attempts, visibility`,
    );
    return rows[0] ?? null;
  }

  /**
   * Advance videos whose bytes are already on the file-service but which
   * are still being scanned there — the video twin of `UploadWorkerService
   * .pollScans`; see that method's own doc comment for the full reasoning
   * (both failure modes it distinguishes apply identically here).
   *
   * This is also what finally gives `session_videos.fs_status` a way to
   * advance past its upload-time value at all for a video routed through
   * this worker — before this task, NOTHING server-side ever polled fs-core
   * for a video (see `SessionVideoService`'s pre-2026-09-09 class doc
   * comment on `SCAN_STALE_MS`); only a kiosk's own now-retired VIDEO_STATUS
   * report ever could.
   */
  private async pollScans(): Promise<void> {
    const rows: ScanningVideoRow[] = await this.dataSource.query(
      `SELECT id, fs_file_id
         FROM session_videos
        WHERE fs_file_id IS NOT NULL
          AND fs_status IN ('UPLOADING', 'SCANNING', 'SCAN_PENDING')
        ORDER BY updated_at ASC
        LIMIT 20`,
    );

    for (const row of rows) {
      try {
        const info = await this.fileStorage.getFile(row.fs_file_id);
        await this.dataSource.query(
          `UPDATE session_videos SET fs_status = $2, fs_status_at = now() WHERE id = $1`,
          [row.id, info.status],
        );
        if (info.status === 'READY') {
          await this.dataSource.query(
            `UPDATE session_videos SET ready_at = now() WHERE id = $1`,
            [row.id],
          );
          await this.dataSource.query(
            `UPDATE video_upload_outbox SET status = 'DONE', content = ''::bytea WHERE video_id = $1`,
            [row.id],
          );
        }
      } catch (err) {
        const fsErr = err instanceof FsError ? err : null;
        if (fsErr && !fsErr.retryable) {
          await this.dataSource.query(
            `UPDATE session_videos SET fs_status = 'FAILED', fs_status_at = now(), upload_error = $2 WHERE id = $1`,
            [row.id, fsErr.message.slice(0, 500)],
          );
          continue;
        }
        this.logger.warn(
          `pollScans failed for video ${row.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async send(job: VideoOutboxRow): Promise<void> {
    try {
      const result = await this.fileStorage.uploadRaw({
        virtualPath: job.virtual_path,
        mimeType: job.mime_type,
        data: new Uint8Array(job.content),
        idempotencyKey: job.idem_key,
        visibility: job.visibility ?? undefined,
      });

      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE session_videos
              SET fs_file_id = $2, fs_etag = $3, fs_status = $4, virtual_path = $5,
                  fs_status_at = now(), uploaded_at = now()
            WHERE id = $1`,
          [
            job.video_id,
            result.fileId,
            result.etag,
            result.status,
            result.virtualPath,
          ],
        );
        // `content` stays put here — see this class's own doc comment (and
        // UploadWorkerService.send's identical 2026-09-09 fix) for why: only
        // pollScans(), and only on a confirmed READY, ever clears it.
        await manager.query(
          `UPDATE video_upload_outbox
              SET status = 'UPLOADED', last_error = NULL
            WHERE id = $1`,
          [job.id],
        );
      });
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  private async recordFailure(job: VideoOutboxRow, err: unknown): Promise<void> {
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
        `UPDATE video_upload_outbox SET status = 'FAILED', last_error = $2 WHERE id = $1`,
        [job.id, message],
      );
      return;
    }

    await this.dataSource.query(
      `UPDATE video_upload_outbox
          SET status = 'PENDING', last_error = $2, next_retry_at = $3
        WHERE id = $1`,
      [job.id, message, computeNextRetryAt(job.attempts)],
    );
  }
}
