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
  status: OutboxStatus;
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
}

export interface OutboxStats {
  pending: number;
  sending: number;
  awaitingScan: number;
  failedPermanent: number;
  oldestPendingAt: number | null;
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
   */
  public enqueue(input: EnqueueInput): void {
    this.db.run(
      `INSERT INTO upload_outbox (
         id, session_id, kind, local_path, virtual_path, mime_type, sha256, size_bytes,
         metadata, idem_key, upload_id, depends_on, status, attempts, next_retry_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
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
        Date.now(),
        Date.now(),
      ]
    );
  }

  /**
   * Jobs ready to send: due, and not waiting on an unfinished dependency.
   */
  public claimDue(now: number, limit = 5): OutboxItem[] {
    const rows = this.db.exec<Record<string, unknown>>(
      `SELECT o.* FROM upload_outbox o
       WHERE o.status = 'PENDING'
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

function toItem(r: Record<string, unknown>): OutboxItem {
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
    idemKey: String(r.idem_key),
    uploadId: String(r.upload_id),
    dependsOn: r.depends_on ? String(r.depends_on) : null,
    status: String(r.status) as OutboxStatus,
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
