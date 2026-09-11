import { SqlExecutor } from '../sql/SqlDriver.js';

export type EmbeddingEnrollmentStatus = 'PENDING' | 'SENDING' | 'DONE' | 'FAILED';

/**
 * Why a row is `FAILED` — mirrors `EmbeddingClientError['kind']` from
 * `@face/biometric`'s `EmbeddingServerClient` (duplicated here rather than
 * imported: `@face/database` has no dependency on `@face/biometric`, the
 * same "duplicate the shape across a package boundary" convention
 * `apps/desktop/src/preload/index.ts` already uses throughout), plus
 * `'GAVE_UP'` for a row that exhausted its retry budget while every failure
 * was a `NETWORK_ERROR` — see `EmbeddingEnrollmentRepository.markGaveUp()`.
 */
export type EmbeddingEnrollmentFailureKind =
  | 'EMPTY_OR_UNREADABLE'
  | 'DUPLICATE_IDENTITY'
  | 'FILE_TOO_LARGE'
  | 'IMAGE_REJECTED'
  | 'GAVE_UP';

export interface EmbeddingEnrollmentItem {
  id: string;
  sessionId: string;
  /** `CaptureStep.id` (`@face/core`) this capture belongs to — see migration 011's own doc comment for why this is generic rather than hardcoded to any one step. */
  stepId: string;
  attempt: number;
  userCode: string;
  /** This row's own durable copy of the captured image — independent of `upload_outbox`'s copy, which can be deleted/superseded on its own lifecycle (a retake, a video's post-upload cleanup) unrelated to whether this embedding has actually reached the server yet. */
  localImagePath: string;
  status: EmbeddingEnrollmentStatus;
  /** Set once DONE — the server's own id for this registered image, needed to delete it individually later. */
  embeddingId: number | null;
  /** Set once DONE — the filename the server recorded, per its own `EnrollResponse`. */
  sourceImagePath: string | null;
  attempts: number;
  nextRetryAt: number | null;
  lastError: string | null;
  failureKind: EmbeddingEnrollmentFailureKind | null;
  /** Set only when failureKind === 'DUPLICATE_IDENTITY' — the user_code the server says already owns this face. */
  conflictUserCode: string | null;
  /** Set only when failureKind === 'DUPLICATE_IDENTITY' — similarity to that user_code's existing registration, -1 to 1. */
  conflictSimilarity: number | null;
  createdAt: number;
  doneAt: number | null;
}

export interface EnqueueEmbeddingInput {
  /** Stable across retries, e.g. `${sessionId}:${stepId}:${attempt}` — matches `upload_outbox`'s own idempotency-key convention (migrations 003/008), so re-enqueuing the same capture is a no-op rather than a duplicate row. */
  id: string;
  sessionId: string;
  stepId: string;
  attempt: number;
  userCode: string;
  localImagePath: string;
}

export interface MarkDoneInput {
  embeddingId: number | null;
  sourceImagePath: string;
}

export interface MarkFailedInput {
  kind: EmbeddingEnrollmentFailureKind;
  error: string;
  conflictUserCode?: string;
  conflictSimilarity?: number;
}

function toItem(r: Record<string, unknown>): EmbeddingEnrollmentItem {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    stepId: String(r.step_id),
    attempt: Number(r.attempt ?? 1),
    userCode: String(r.user_code),
    localImagePath: String(r.local_image_path),
    status: r.status as EmbeddingEnrollmentStatus,
    embeddingId: r.embedding_id === null || r.embedding_id === undefined ? null : Number(r.embedding_id),
    sourceImagePath: r.source_image_path ? String(r.source_image_path) : null,
    attempts: Number(r.attempts ?? 0),
    nextRetryAt: r.next_retry_at === null || r.next_retry_at === undefined ? null : Number(r.next_retry_at),
    lastError: r.last_error ? String(r.last_error) : null,
    failureKind: (r.failure_kind as EmbeddingEnrollmentFailureKind | null) ?? null,
    conflictUserCode: r.conflict_user_code ? String(r.conflict_user_code) : null,
    conflictSimilarity:
      r.conflict_similarity === null || r.conflict_similarity === undefined ? null : Number(r.conflict_similarity),
    createdAt: Number(r.created_at),
    doneAt: r.done_at === null || r.done_at === undefined ? null : Number(r.done_at),
  };
}

/**
 * Local tracking table for the external Face Enrollment API integration —
 * see migration 011's own doc comment for the full reasoning. Never stores
 * an embedding vector (the external server never returns one); this is
 * purely (a) a durable local copy of each enrolled image so a network
 * failure can be retried without depending on the renderer still being
 * open, and (b) a reference back to what the server holds (`embeddingId`)
 * for later deletion/audit.
 *
 * Retry shape mirrors `UploadOutboxRepository` deliberately (same
 * `claimDue`/`markSending`/`markRetry`/`recoverInterrupted` vocabulary) —
 * the desktop main process's embedding retry worker is the same
 * durable-local-write-then-background-retry pattern as the existing photo
 * upload worker, just against this table instead of `upload_outbox`.
 */
export class EmbeddingEnrollmentRepository {
  constructor(private db: SqlExecutor) {}

  /**
   * Record a capture as needing enrollment. Call inside the same transaction
   * that writes `localImagePath` to disk, so a crash cannot leave a file on
   * disk with no row pointing at it (or vice versa) — same reasoning as
   * `uploads.ts`'s `queueCapture()`.
   *
   * `ON CONFLICT(id) DO NOTHING`: re-enqueuing the same
   * `(sessionId, stepId, attempt)` (e.g. a duplicate IPC call) is a no-op,
   * not a second row.
   */
  public enqueue(input: EnqueueEmbeddingInput): void {
    this.db.run(
      `INSERT INTO embedding_enrollments (
         id, session_id, step_id, attempt, user_code, local_image_path,
         status, attempts, next_retry_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        input.id,
        input.sessionId,
        input.stepId,
        input.attempt,
        input.userCode,
        input.localImagePath,
        Date.now(),
        Date.now(),
      ]
    );
  }

  /** Rows ready to (re)send: due and not already in flight. */
  public claimDue(now: number, limit = 5): EmbeddingEnrollmentItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM embedding_enrollments
        WHERE status = 'PENDING'
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?`,
      [now, limit]
    );
    return rows.map(toItem);
  }

  public markSending(id: string): void {
    this.db.run(`UPDATE embedding_enrollments SET status = 'SENDING' WHERE id = ?`, [id]);
  }

  /** The server accepted this image and returned its own reference for it. */
  public markDone(id: string, result: MarkDoneInput): void {
    this.db.run(
      `UPDATE embedding_enrollments
          SET status = 'DONE', embedding_id = ?, source_image_path = ?, done_at = ?, last_error = NULL
        WHERE id = ?`,
      [result.embeddingId, result.sourceImagePath, Date.now(), id]
    );
  }

  /**
   * A rejection the server would repeat identically for these exact bytes
   * (400/409/413/422) — never automatically retried. See
   * `EmbeddingServerError.retryable`'s own doc comment in `@face/biometric`
   * for why only `NETWORK_ERROR` goes through `markRetry` instead.
   */
  public markFailed(id: string, input: MarkFailedInput): void {
    this.db.run(
      `UPDATE embedding_enrollments
          SET status = 'FAILED', attempts = attempts + 1, failure_kind = ?, last_error = ?,
              conflict_user_code = ?, conflict_similarity = ?
        WHERE id = ?`,
      [
        input.kind,
        input.error.slice(0, 500),
        input.conflictUserCode ?? null,
        input.conflictSimilarity ?? null,
        id,
      ]
    );
  }

  /** A transport/server failure — worth trying again later. */
  public markRetry(id: string, error: string, delayMs: number): void {
    this.db.run(
      `UPDATE embedding_enrollments
          SET status = 'PENDING', attempts = attempts + 1, next_retry_at = ?, last_error = ?
        WHERE id = ?`,
      [Date.now() + delayMs, error.slice(0, 500), id]
    );
  }

  /** Retry budget exhausted while every failure was a NETWORK_ERROR — stop retrying, but distinguish this from a rejection the server actually looked at and refused. */
  public markGaveUp(id: string, error: string): void {
    this.markFailed(id, { kind: 'GAVE_UP', error });
  }

  /**
   * Rows abandoned mid-send by a crashed process, returned to the queue.
   * Run once at startup, same as `UploadOutboxRepository.recoverInterrupted()`.
   */
  public recoverInterrupted(): number {
    const stuck = this.db.exec<{ n: number }>(
      `SELECT COUNT(*) AS n FROM embedding_enrollments WHERE status = 'SENDING'`
    );
    this.db.run(`UPDATE embedding_enrollments SET status = 'PENDING', next_retry_at = NULL WHERE status = 'SENDING'`);
    return Number(stuck[0]?.n ?? 0);
  }

  public getById(id: string): EmbeddingEnrollmentItem | null {
    const rows = this.db.exec<Record<string, unknown>>('SELECT * FROM embedding_enrollments WHERE id = ?', [id]);
    return rows.length > 0 ? toItem(rows[0]) : null;
  }

  /** Every enrollment attempt recorded for a session, oldest first — e.g. to tell the UI whether this session's CENTER step ever actually reached the server. */
  public listBySession(sessionId: string): EmbeddingEnrollmentItem[] {
    return this.db
      .exec<Record<string, unknown>>(`SELECT * FROM embedding_enrollments WHERE session_id = ? ORDER BY created_at ASC`, [
        sessionId,
      ])
      .map(toItem);
  }
}
