import { EmbeddingServerClient, EmbeddingServerError } from '@face/biometric';
import { STATS_UNKNOWN_UUID } from '@app/modules/stats/stats.constants';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EMBEDDING_MAX_ATTEMPTS } from '../capture.constants';
import { computeNextRetryAt } from './upload-worker.service';

interface EmbeddingJobRow {
  id: string;
  photo_id: string;
  user_code: string;
  mime_type: string;
  content: Buffer;
  attempts: number;
}

/** Mirrors `PhotoService`'s own `mimeType === 'image/png' ? 'png' : 'jpg'` convention — used only to build a filename the server records, never to validate the bytes. */
function extensionFromMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

/**
 * Drains `embedding_jobs`, registering each queued photo with the external
 * face-embedding server (`@face/biometric`'s `EmbeddingServerClient`).
 *
 * 2026-09-16 — this is the backend half of moving embedding registration off
 * the desktop kiosk ("tôi muốn phần embedding đó sẽ do backend xử lý, khi
 * nhận ảnh và lưu sang file server thì chạy bất đồng bộ để embedding"):
 * `PhotoService.addPhoto`/`addDevicePhoto` enqueue a row here, in the same
 * transaction as the photo/`upload_outbox` write, the instant a photo is
 * saved — this service is what actually calls the external server,
 * asynchronously, exactly mirroring `UploadWorkerService`'s own shape
 * (crash-recovery on boot, a 3s `@Cron` claim loop guarded by a `running`
 * flag, `FOR UPDATE SKIP LOCKED` claiming, exponential backoff via the same
 * `computeNextRetryAt` that service exports) rather than inventing a new
 * worker pattern.
 *
 * Replaces `apps/desktop/src/main/embeddingEnroll.ts`'s old per-photo
 * `embedding:enrollFace` IPC call + local SQLite retry queue entirely — see
 * that file's own (now much smaller) doc comment for what stayed behind
 * (the admin list/delete/health operations, unrelated to this pipeline).
 */
@Injectable()
export class EmbeddingWorkerService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingWorkerService.name);
  private running = false;
  private readonly embeddingClient: EmbeddingServerClient;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    // Same "read inline via ConfigService, no dedicated registerAs() config
    // file" convention `PhotoReviewSidecarService` uses for
    // `PYTHON_AI_BASE_URL` — see that class's own doc comment. Falls back to
    // the same real, network-reachable server the old desktop client
    // defaulted to (`DEFAULT_EMBEDDING_SERVER_BASE_URL` in the now-trimmed
    // `embeddingEnroll.ts`), now that the backend is the one calling it.
    const baseUrl =
      configService.get<string>('EMBEDDING_SERVER_BASE_URL')?.trim() ||
      'http://10.20.107.17:8000';
    this.embeddingClient = new EmbeddingServerClient({ baseUrl });
  }

  async onModuleInit(): Promise<void> {
    // Anything left SENDING belongs to a process that died mid-flight —
    // same crash-recovery reasoning as UploadWorkerService.onModuleInit.
    await this.dataSource
      .query(
        `UPDATE embedding_jobs SET status = 'PENDING' WHERE status = 'SENDING'`,
      )
      .catch((err) =>
        this.logger.warn(
          `recoverInterrupted failed: ${(err as Error).message}`,
        ),
      );
  }

  // Same 3s cadence as UploadWorkerService.drain() — a queue draining right
  // after a photo is captured needs a tighter poll than CronExpression's
  // finest named step (30s).
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
    } catch (err) {
      // A background drain must never take the process down — the queue is
      // durable, whatever went wrong here is retried on the next tick.
      this.logger.error(`tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Take one job, marking it SENDING in the same statement — same
   * `FOR UPDATE SKIP LOCKED` shape as `UploadWorkerService.claimNext`.
   *
   * `DataSource.query()` returns `[rows, affectedCount]` for a non-SELECT
   * statement with RETURNING, not a flat rows array — destructuring straight
   * into `rows` here (rather than binding the whole tuple to that name) is
   * the exact bug class this codebase's own `UploadWorkerService.claimNext`
   * doc comment warns has bitten it before; guarded against explicitly here
   * for the same reason.
   */
  private async claimNext(): Promise<EmbeddingJobRow | null> {
    const [rows]: [EmbeddingJobRow[], number] = await this.dataSource.query(
      `UPDATE embedding_jobs
          SET status = 'SENDING', attempts = attempts + 1
        WHERE id = (
          SELECT id FROM embedding_jobs
           WHERE status = 'PENDING' AND next_retry_at <= now()
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, photo_id, user_code, mime_type, content, attempts`,
    );
    return rows[0] ?? null;
  }

  private async send(job: EmbeddingJobRow): Promise<void> {
    try {
      // `new Uint8Array(job.content)` — a plain Buffer isn't assignable to
      // BlobPart (its `buffer` is typed `ArrayBufferLike`, which admits
      // `SharedArrayBuffer`); a fresh Uint8Array view over the same bytes
      // is. Same conversion `UploadWorkerService.send()` already does when
      // handing a `bytea` column's bytes to `fileStorage.uploadRaw`.
      const blob = new Blob([new Uint8Array(job.content)], {
        type: job.mime_type,
      });
      const fileName = `${job.photo_id}.${extensionFromMime(job.mime_type)}`;
      const result = await this.embeddingClient.enrollFace(
        job.user_code,
        blob,
        fileName,
      );

      // `content` cleared only on this terminal-success transition —
      // mirrors `upload_outbox`'s own "clear bytes only once terminal-
      // success" pattern (see `UploadWorkerService.applyUploadSuccess`'s
      // doc comment).
      await this.dataSource.query(
        `UPDATE embedding_jobs
            SET status = 'DONE', embedding_id = $2, content = ''::bytea, last_error = NULL
          WHERE id = $1`,
        [job.id, result.embeddingId],
      );
      await this.recordDeviceEvent(job.photo_id, 'EMBEDDING_ENROLLED', {
        photoId: job.photo_id,
        userCode: job.user_code,
        embeddingId: result.embeddingId,
        sourceImagePath: result.sourceImagePath,
      });
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  /**
   * Retryable vs terminal, same split `UploadWorkerService.recordFailure`
   * uses via `FsError.retryable` — here via `EmbeddingServerError.retryable`
   * (true only for `NETWORK_ERROR`, i.e. a transport failure or an
   * unexpected/5xx status; 400/409/413/422 are all terminal on the first
   * attempt — see that class's own doc comment in `@face/biometric`).
   * `EMBEDDING_FAILED` is recorded once only, on the actual terminal
   * transition (a real rejection, or a `NETWORK_ERROR` that has exhausted
   * `EMBEDDING_MAX_ATTEMPTS`) — never on an ordinary in-progress retry, the
   * same "don't spam device_events for a transient blip" rule the old
   * desktop client's `applyFailure` already followed.
   */
  private async recordFailure(
    job: EmbeddingJobRow,
    err: unknown,
  ): Promise<void> {
    const embeddingErr = err instanceof EmbeddingServerError ? err : null;
    const message = ((err as Error)?.message ?? String(err)).slice(0, 500);
    const detail = embeddingErr?.detail;

    const retryable = embeddingErr !== null && embeddingErr.retryable;
    const exhausted = job.attempts >= EMBEDDING_MAX_ATTEMPTS;

    if (retryable && !exhausted) {
      await this.dataSource.query(
        `UPDATE embedding_jobs
            SET status = 'PENDING', last_error = $2, next_retry_at = $3
          WHERE id = $1`,
        [job.id, message, computeNextRetryAt(job.attempts)],
      );
      return;
    }

    await this.dataSource.query(
      `UPDATE embedding_jobs SET status = 'FAILED', last_error = $2 WHERE id = $1`,
      [job.id, message],
    );
    await this.recordDeviceEvent(job.photo_id, 'EMBEDDING_FAILED', {
      photoId: job.photo_id,
      userCode: job.user_code,
      failureKind: detail?.kind ?? 'UNKNOWN',
      error: message,
      conflictUserCode:
        detail?.kind === 'DUPLICATE_IDENTITY'
          ? detail.conflictUserCode
          : undefined,
      conflictSimilarity:
        detail?.kind === 'DUPLICATE_IDENTITY'
          ? detail.conflictSimilarity
          : undefined,
    });
  }

  /**
   * Writes an `EMBEDDING_ENROLLED`/`EMBEDDING_FAILED` row straight into
   * `device_events`, in-process, rather than routing through
   * `DeviceEventService.recordBatch` — that method's whole contract assumes
   * an HTTP-originated kiosk caller (a real `deviceId`, batched events,
   * SESSION_REPORT-style side effects) that doesn't fit a background worker
   * reacting to its own queue. Writing the row directly here keeps
   * `DeviceEventService.campaignStats`/`allCampaignsStats`'s existing
   * `COUNT(*) ... GROUP BY type` queries working completely unchanged — they
   * read `device_events` itself, not how a row got there.
   *
   * `device_events.device_id`/`campaign_id` are both `NOT NULL` at the DB
   * level (see `CreateDeviceEvents1787600000000`), so both are resolved here
   * via the photo's own session rather than assumed present on the job row
   * itself (`embedding_jobs` carries neither). `campaignId` is expected to
   * always resolve — `PhotoService` only ever enqueues an `embedding_jobs`
   * row for a session with a known `campaignId` (see its own enqueue-time
   * guard) — so a missing one here is logged and skipped rather than thrown,
   * the same defensive posture `UploadWorkerService.recordFailure` takes for
   * its own "should be unreachable" guard. `deviceId` legitimately can be
   * null (a WEB-path session has no device), and falls back to
   * `STATS_UNKNOWN_UUID` — the same sentinel `stats_daily_captures`/
   * `CaptureStatsService` already use for exactly this case.
   */
  private async recordDeviceEvent(
    photoId: string,
    type: 'EMBEDDING_ENROLLED' | 'EMBEDDING_FAILED',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const rows: Array<{
      campaign_id: string | null;
      device_id: string | null;
    }> = await this.dataSource.query(
      `SELECT s.campaign_id, s.device_id
           FROM photos p
           JOIN sessions s ON s.id = p.session_id
          WHERE p.id = $1`,
      [photoId],
    );
    const campaignId = rows[0]?.campaign_id;
    if (!campaignId) {
      this.logger.warn(
        `recordDeviceEvent: photo ${photoId} has no campaignId — skipping device_events row`,
      );
      return;
    }
    const deviceId = rows[0]?.device_id ?? STATS_UNKNOWN_UUID;

    await this.dataSource.query(
      `INSERT INTO device_events (device_id, campaign_id, type, occurred_at, metadata)
       VALUES ($1, $2, $3, now(), $4::jsonb)`,
      [deviceId, campaignId, type, JSON.stringify(metadata)],
    );
  }
}
