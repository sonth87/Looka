import type { Visibility } from '@face/core';
import { SqlExecutor } from '../sql/SqlDriver.js';

export type OutboxStatus = 'PENDING' | 'SENDING' | 'UPLOADED' | 'DONE' | 'FAILED_PERMANENT';

export interface OutboxItem {
  id: string;
  sessionId: string;
  kind: string;
  localPath: string;
  virtualPath: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  metadata: Record<string, string> | null;
  idemKey: string;
  uploadId: string;
  dependsOn: string | null;
  /** Decided by the caller that enqueued the job. null means "let the file-service apply its own default." */
  visibility: Visibility | null;
  status: OutboxStatus;
  /**
   * When the operator approved this row's session for upload, or null while
   * it is still staged awaiting review. Gates claimDue() — see
   * approveSession() — and doubles as this session's upload history: paired
   * with `doneAt`, it answers "was this actually sent, and when."
   */
  approvedAt: number | null;
  /**
   * Which workflow step this capture belongs to, e.g. 'step-front'. Backed by
   * its own column since migration 008, falling back to a parse of
   * `idemKey` for rows written before that migration — see `toItem()` and
   * migration 008's own doc comment for why that fallback is exact, not a
   * guess. Only null if `idemKey` itself does not match the expected shape,
   * which no code path that writes this table produces.
   */
  stepId: string | null;
  /**
   * Which attempt at `stepId` this is, numbered from 1 within the session —
   * see `stepId`'s own doc comment for where this comes from pre- and
   * post-migration 008. `approveSession()` keeps only the highest of these
   * per `(kind, stepId)`.
   */
  attempt: number | null;
  attempts: number;
  nextRetryAt: number | null;
  lastError: string | null;
  fsFileId: string | null;
  fsStatus: string | null;
  fsStatusAt: number | null;
  createdAt: number;
  doneAt: number | null;
}

export interface EnqueueInput {
  id: string;
  sessionId: string;
  kind: string;
  localPath: string;
  virtualPath: string;
  mimeType?: string;
  sha256: string;
  sizeBytes: number;
  metadata?: Record<string, string>;
  /** Stable across retries. Uniqueness is enforced by the database. */
  idemKey: string;
  uploadId: string;
  /** Upload this only after the referenced item has finished. */
  dependsOn?: string;
  /**
   * public or private, decided here — the point that knows what this capture
   * actually is. Omitted means the file-service applies its own default;
   * this repository never substitutes one on the caller's behalf.
   */
  visibility?: Visibility;
  /**
   * Optional explicit values for the columns migration 008 added. Omitted is
   * perfectly safe — `toItem()` recovers both from `idemKey` on read — but a
   * caller that already has them on hand (queueCapture() always does) should
   * pass them through rather than make every future read re-parse a string.
   */
  stepId?: string;
  attempt?: number;
  /**
   * Pass this when the caller is enqueueing an already-reviewed capture —
   * video is enqueued at the moment of "Xác nhận & Lưu hồ sơ" itself (see
   * apps/desktop/src/main/uploads.ts's approveSessionUpload()), so there is
   * no separate staged-then-approved window the way a photo has. Omitted
   * (the photo path) leaves the row staged, exactly as before.
   */
  approvedAt?: number;
}

export interface OutboxStats {
  pending: number;
  sending: number;
  awaitingScan: number;
  failedPermanent: number;
  oldestPendingAt: number | null;
}


/** Result of approveSession() — see that method's own doc comment. */
export interface ApproveSessionResult {
  /** Rows newly approved by this call. 0 for an already-approved or nonexistent session — a harmless no-op, not an error. */
  approved: number;
  /** Rows this call deleted because a later attempt at the same step superseded them, so the caller can unlink their local files. */
  superseded: Array<{ id: string; localPath: string }>;
  /**
   * The actual rows newly approved (same rows `approved` counts) — added for
   * the post-save retake feature (2026-09-08): the caller needs each row's
   * `kind`/`stepId` to look for an OLDER, already-approved-in-a-PREVIOUS-call
   * attempt at that same `(kind, stepId)` via `supersedeOlderApprovedAttempts()`
   * below, which this method's own supersede logic cannot find (it only ever
   * compares rows staged together in this one call — see that method's own
   * doc comment for why a separate pass is needed).
   */
  approvedRows: OutboxItem[];
}

/** Exponential backoff with jitter, capped so a long outage still retries hourly-ish. */
export function nextRetryDelayMs(attempts: number, baseMs = 5_000, capMs = 600_000): number {
  const exponential = Math.min(baseMs * 2 ** attempts, capMs);
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(exponential + jitter));
}

export class UploadOutboxRepository {
  constructor(private db: SqlExecutor) {}

  /**
   * Add an upload job.
   *
   * Call inside the same transaction that writes the image row, so a capture is
   * either fully recorded or not recorded at all. Re-enqueuing the same idemKey
   * is ignored rather than duplicated.
   *
   * The row starts staged — `approved_at` is left NULL, so claimDue() will not
   * pick it up — until the operator reviews the session and approveSession()
   * releases it. This is the "capture first, upload only after explicit
   * approval" gate; see approveSession()'s own doc comment.
   *
   * Pass `approvedAt` to skip that staging window entirely and enqueue an
   * already-approved row — the video path uses this, since it is only ever
   * enqueued at the moment of approval itself (see apps/desktop/src/main/
   * uploads.ts's approveSessionUpload()), so there is nothing to stage.
   */
  public enqueue(input: EnqueueInput): void {
    this.db.run(
      `INSERT INTO upload_outbox (
         id, session_id, kind, local_path, virtual_path, mime_type, sha256, size_bytes,
         metadata, idem_key, upload_id, depends_on, visibility, step_id, attempt,
         status, attempts, next_retry_at, created_at, approved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)
       ON CONFLICT(idem_key) DO NOTHING`,
      [
        input.id,
        input.sessionId,
        input.kind,
        input.localPath,
        input.virtualPath,
        input.mimeType ?? 'image/jpeg',
        input.sha256,
        input.sizeBytes,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.idemKey,
        input.uploadId,
        input.dependsOn ?? null,
        input.visibility ?? null,
        input.stepId ?? null,
        input.attempt ?? null,
        Date.now(),
        Date.now(),
        input.approvedAt ?? null,
      ]
    );
  }

  /**
   * Jobs ready to send: due, approved, and not waiting on an unfinished
   * dependency.
   *
   * `approved_at IS NOT NULL` is the staging gate — a row a session's operator
   * has not yet confirmed sits here forever, harmlessly, until
   * approveSession() releases it. See that method and migration 005 for why
   * this is a separate column rather than a new `status` value.
   */
  public claimDue(now: number, limit = 5): OutboxItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT o.* FROM upload_outbox o
       WHERE o.status = 'PENDING'
         AND o.approved_at IS NOT NULL
         AND (o.next_retry_at IS NULL OR o.next_retry_at <= ?)
         AND (o.depends_on IS NULL OR EXISTS (
               SELECT 1 FROM upload_outbox d
                WHERE d.id = o.depends_on AND d.status IN ('UPLOADED','DONE')))
       ORDER BY o.created_at ASC
       LIMIT ?`,
      [now, limit]
    );
    return rows.map(toItem);
  }

  /**
   * Release a reviewed session's staged captures for upload.
   *
   * The operator has just confirmed this session in the review screen; every
   * row still awaiting approval for it is stamped with the approval time and
   * becomes visible to claimDue() from here on — the existing UploadWorker
   * drains it exactly as it always has, unaware anything changed. Rows
   * already approved (or from a different session) are left untouched, so
   * calling this again for the same session — a double click, or a retried
   * IPC call — is a harmless no-op that returns 0.
   *
   * `next_retry_at` is cleared defensively: a freshly staged row is always
   * already due (enqueue() sets it to "now"), so this is not required for the
   * normal path, but it keeps this method correct even if something upstream
   * ever changes that assumption.
   *
   * A session nobody ever approves — the operator walks away, the app
   * crashes, the run is cancelled — simply never has this called for it. Its
   * rows stay staged indefinitely: harmless and recoverable, never uploaded
   * behind the operator's back and never deleted. See FaceCaptureApp's
   * handleRestart/handleCancelWorkflow for the run-abandonment paths this
   * relies on never reaching this method.
   *
   * Returns how many rows this call actually moved, so a caller can tell a
   * genuine approval from a no-op repeat.
   */
  public approveSession(sessionId: string): ApproveSessionResult {
    return this.db.transaction(() => {
      const staged = this.db
        .exec<Record<string, unknown>>(
          `SELECT * FROM upload_outbox WHERE session_id = ? AND approved_at IS NULL`,
          [sessionId]
        )
        .map(toItem);

      if (staged.length === 0) return { approved: 0, superseded: [], approvedRows: [] };

      // Group by (kind, stepId) — see D5 in the phase-11 plan. A stepId that
      // somehow fails to resolve (never observed — see toItem()'s fallback)
      // groups under this row's own id instead of null, so a row this
      // defensive branch cannot make sense of is always kept on its own,
      // never merged with an unrelated one.
      const groups = new Map<string, OutboxItem[]>();
      for (const item of staged) {
        const key = `${item.kind} ${item.stepId ?? `row:${item.id}`}`;
        const list = groups.get(key);
        if (list) list.push(item);
        else groups.set(key, [item]);
      }

      // Highest attempt per group wins; a tie (should not happen — attempt
      // plus stepId plus kind is exactly what idem_key's uniqueness already
      // guards) is broken by whichever row was captured most recently.
      const keep: OutboxItem[] = [];
      const superseded: Array<{ id: string; localPath: string }> = [];
      for (const list of groups.values()) {
        list.sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0) || b.createdAt - a.createdAt);
        const [winner, ...losers] = list;
        keep.push(winner);
        for (const loser of losers) superseded.push({ id: loser.id, localPath: loser.localPath });
      }

      const now = Date.now();
      const keepPlaceholders = keep.map(() => '?').join(',');
      this.db.run(
        `UPDATE upload_outbox
            SET approved_at = ?, next_retry_at = NULL
          WHERE id IN (${keepPlaceholders})`,
        [now, ...keep.map((i) => i.id)]
      );

      // Superseded rows are still unapproved by construction (the SELECT
      // above only ever considered approved_at IS NULL rows), so this can
      // never touch a row already released to the UploadWorker or already
      // uploaded. See D5 for why deleting — rather than a "superseded"
      // status — is correct: the status CHECK constraint (migration 003) has
      // no such value, and a deleted row can never be resurrected by
      // claimDue().
      if (superseded.length > 0) {
        const delPlaceholders = superseded.map(() => '?').join(',');
        this.db.run(`DELETE FROM upload_outbox WHERE id IN (${delPlaceholders})`, superseded.map((s) => s.id));
      }

      return { approved: keep.length, superseded, approvedRows: keep };
    });
  }

  /**
   * Post-save retake (2026-09-08): finds and deletes any OTHER row already
   * approved for `(sessionId, kind, stepId)` from an EARLIER call to
   * `approveSession()` — the case that method's own supersede logic cannot
   * reach, since it only ever compares rows staged together in one call (see
   * its own doc comment). Call once per row `approveSession()` just approved,
   * passing that row's own id as `keepId`.
   *
   * Unlike `approveSession()`'s supersede path, a row found here may already
   * be `DONE`/uploaded — the caller is responsible for also removing it from
   * the file-service (`fsFileId`) and reporting the deletion centrally, not
   * just unlinking the local file. Returns what it deleted so the caller can
   * do both; an empty array (the common case — most attempts are never
   * retaken after approval) means there was nothing to do.
   */
  public supersedeOlderApprovedAttempts(
    sessionId: string,
    kind: string,
    stepId: string,
    keepId: string
  ): Array<{ id: string; localPath: string; fsFileId: string | null }> {
    return this.db.transaction(() => {
      const rows = this.db
        .exec<Record<string, unknown>>(
          `SELECT * FROM upload_outbox
            WHERE session_id = ? AND kind = ? AND step_id = ? AND approved_at IS NOT NULL AND id != ?`,
          [sessionId, kind, stepId, keepId]
        )
        .map(toItem);

      if (rows.length === 0) return [];

      const placeholders = rows.map(() => '?').join(',');
      this.db.run(`DELETE FROM upload_outbox WHERE id IN (${placeholders})`, rows.map((r) => r.id));

      return rows.map((r) => ({ id: r.id, localPath: r.localPath, fsFileId: r.fsFileId }));
    });
  }

  /**
   * Every row on file for a session, in capture order — survivors and
   * terminal (DONE/FAILED_PERMANENT) rows alike.
   *
   * Meant to be called right after approveSession() has removed the
   * superseded rows of a fresh approval: at that point "still here" already
   * means "final," which is what lets apps/desktop's approveSessionUpload()
   * build the SESSION_REPORT stats event straight from this list without a
   * second filter. Unlike listSessionPhotos() (apps/desktop/src/main/
   * uploads.ts), this returns the full OutboxItem — mimeType, sha256,
   * virtualPath and friends — because the report needs all of it, not just
   * what a status panel would show.
   */
  public listBySession(sessionId: string): OutboxItem[] {
    return this.db
      .exec<Record<string, unknown>>(
        `SELECT * FROM upload_outbox WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId]
      )
      .map(toItem);
  }

  public markSending(id: string): void {
    this.db.run(`UPDATE upload_outbox SET status = 'SENDING' WHERE id = ?`, [id]);
  }

  /** Bytes accepted by the server; the file is not readable yet. */
  public markUploaded(id: string, fsFileId: string, fsStatus: string): void {
    this.db.run(
      `UPDATE upload_outbox
          SET status = 'UPLOADED', fs_file_id = ?, fs_status = ?, fs_status_at = ?, last_error = NULL
        WHERE id = ?`,
      [fsFileId, fsStatus, Date.now(), id]
    );
  }

  /** Server finished scanning and the file is usable. */
  public markDone(id: string, fsStatus = 'READY'): void {
    this.db.run(
      `UPDATE upload_outbox
          SET status = 'DONE', fs_status = ?, fs_status_at = ?, done_at = ?
        WHERE id = ?`,
      [fsStatus, Date.now(), Date.now(), id]
    );
  }

  public updateFsStatus(id: string, fsStatus: string): void {
    this.db.run(`UPDATE upload_outbox SET fs_status = ?, fs_status_at = ? WHERE id = ?`, [
      fsStatus,
      Date.now(),
      id,
    ]);
  }

  /** Recoverable failure: count it and schedule another attempt. */
  public markRetry(id: string, error: string, delayMs: number): void {
    this.db.run(
      `UPDATE upload_outbox
          SET status = 'PENDING', attempts = attempts + 1, next_retry_at = ?, last_error = ?
        WHERE id = ?`,
      [Date.now() + delayMs, error.slice(0, 500), id]
    );
  }

  /** Unrecoverable, or out of budget. Needs a person to look at it. */
  public markFailedPermanent(id: string, error: string): void {
    this.db.run(
      `UPDATE upload_outbox
          SET status = 'FAILED_PERMANENT', attempts = attempts + 1, last_error = ?
        WHERE id = ?`,
      [error.slice(0, 500), id]
    );
  }

  /** Items whose bytes are in but which are still being scanned. */
  public listAwaitingScan(limit = 20): OutboxItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM upload_outbox WHERE status = 'UPLOADED' ORDER BY fs_status_at ASC LIMIT ?`,
      [limit]
    );
    return rows.map(toItem);
  }

  /**
   * Items stuck waiting for a scan longer than expected.
   *
   * The server does not always resolve this state on its own, so nothing else
   * will raise the alarm.
   */
  public listStuckAwaitingScan(olderThanMs: number, now = Date.now()): OutboxItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT * FROM upload_outbox
        WHERE status = 'UPLOADED' AND fs_status_at IS NOT NULL AND fs_status_at < ?`,
      [now - olderThanMs]
    );
    return rows.map(toItem);
  }

  /**
   * Return jobs abandoned mid-flight to the queue.
   *
   * Run at startup: a crash leaves rows in SENDING that no worker owns, and
   * without this they never move again.
   */
  public recoverInterrupted(): number {
    const stuck = this.db.exec<{ n: number }>(
      `SELECT COUNT(*) AS n FROM upload_outbox WHERE status = 'SENDING'`
    );
    this.db.run(
      `UPDATE upload_outbox SET status = 'PENDING', next_retry_at = NULL WHERE status = 'SENDING'`
    );
    return Number(stuck[0]?.n ?? 0);
  }

  /** Put a permanently failed job back in the queue after an operator intervenes. */
  public retryFailed(id: string): void {
    this.db.run(
      `UPDATE upload_outbox
          SET status = 'PENDING', attempts = 0, next_retry_at = NULL, last_error = NULL
        WHERE id = ? AND status = 'FAILED_PERMANENT'`,
      [id]
    );
  }

  public getById(id: string): OutboxItem | null {
    const rows = this.db.exec<Record<string, unknown>>('SELECT * FROM upload_outbox WHERE id = ?', [id]);
    return rows.length > 0 ? toItem(rows[0]) : null;
  }

  public stats(): OutboxStats {
    const counts = this.db.exec<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM upload_outbox GROUP BY status'
    );
    const by = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);

    const oldest = this.db.exec<{ t: number | null }>(
      `SELECT MIN(created_at) AS t FROM upload_outbox WHERE status = 'PENDING'`
    );

    return {
      pending: by('PENDING'),
      sending: by('SENDING'),
      awaitingScan: by('UPLOADED'),
      failedPermanent: by('FAILED_PERMANENT'),
      oldestPendingAt: oldest[0]?.t ?? null,
    };
  }
}

/**
 * Recovers the step id encoded in idem_key (`<sessionId>:<stepId>:<attempt>:
 * <kind>`) for a row written before migration 008 added its own column — see
 * that migration's own doc comment for why this is an exact recovery, not a
 * guess: none of the three other parts can contain the ':' this splits on.
 * Returns null only if idemKey does not have the expected shape at all,
 * which no code path that writes this table produces.
 */
function stepIdFromIdemKey(idemKey: string): string | null {
  const parts = idemKey.split(':');
  if (parts.length < 4) return null;
  const stepId = parts.slice(1, parts.length - 2).join(':');
  return stepId.length > 0 ? stepId : null;
}

/** Same recovery as stepIdFromIdemKey(), for the attempt number instead. */
function attemptFromIdemKey(idemKey: string): number | null {
  const parts = idemKey.split(':');
  if (parts.length < 4) return null;
  const attempt = Number(parts[parts.length - 2]);
  return Number.isFinite(attempt) ? attempt : null;
}

function toItem(r: Record<string, unknown>): OutboxItem {
  const idemKey = String(r.idem_key);
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    kind: String(r.kind),
    localPath: String(r.local_path),
    virtualPath: String(r.virtual_path),
    mimeType: String(r.mime_type ?? 'image/jpeg'),
    sha256: String(r.sha256),
    sizeBytes: Number(r.size_bytes ?? 0),
    metadata: r.metadata ? (JSON.parse(String(r.metadata)) as Record<string, string>) : null,
    idemKey,
    uploadId: String(r.upload_id),
    dependsOn: r.depends_on ? String(r.depends_on) : null,
    visibility: r.visibility === 'public' || r.visibility === 'private' ? r.visibility : null,
    status: String(r.status) as OutboxStatus,
    approvedAt: r.approved_at === null || r.approved_at === undefined ? null : Number(r.approved_at),
    stepId: r.step_id !== null && r.step_id !== undefined ? String(r.step_id) : stepIdFromIdemKey(idemKey),
    attempt: r.attempt === null || r.attempt === undefined ? attemptFromIdemKey(idemKey) : Number(r.attempt),
    attempts: Number(r.attempts ?? 0),
    nextRetryAt: r.next_retry_at === null || r.next_retry_at === undefined ? null : Number(r.next_retry_at),
    lastError: r.last_error ? String(r.last_error) : null,
    fsFileId: r.fs_file_id ? String(r.fs_file_id) : null,
    fsStatus: r.fs_status ? String(r.fs_status) : null,
    fsStatusAt: r.fs_status_at === null || r.fs_status_at === undefined ? null : Number(r.fs_status_at),
    createdAt: Number(r.created_at),
    doneAt: r.done_at === null || r.done_at === undefined ? null : Number(r.done_at),
  };
}
