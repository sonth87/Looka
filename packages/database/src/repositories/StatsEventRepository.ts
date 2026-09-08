import { SqlExecutor } from '../sql/SqlDriver.js';

export type StatsEventType =
  | 'SESSION_COMPLETED'
  | 'UPLOAD_SUCCESS'
  | 'UPLOAD_FAILED'
  | 'RETAKE'
  | 'CB_HELP_INTERVENTION'
  | 'SESSION_REPORT'
  | 'PHOTO_STATUS'
  | 'VIDEO_STATUS'
  | 'ATTEMPT_SUPERSEDED';

export interface StatsEventItem {
  id: string;
  type: StatsEventType;
  occurredAt: number;
  metadata: Record<string, unknown> | null;
  status: 'PENDING' | 'SENT';
  createdAt: number;
  sentAt: number | null;
}

export interface EnqueueStatsEventInput {
  id: string;
  type: StatsEventType;
  occurredAt: number;
  metadata?: Record<string, unknown>;
}

function toItem(r: Record<string, unknown>): StatsEventItem {
  return {
    id: String(r.id),
    type: String(r.type) as StatsEventType,
    occurredAt: Number(r.occurred_at),
    metadata: r.metadata ? (JSON.parse(String(r.metadata)) as Record<string, unknown>) : null,
    status: String(r.status) as 'PENDING' | 'SENT',
    createdAt: Number(r.created_at),
    sentAt: r.sent_at === null || r.sent_at === undefined ? null : Number(r.sent_at),
  };
}

/**
 * Local queue for events destined for the admin portal's stats — see
 * docs/plans/multi-camera-device-management-discussion.md §3.3/§3.4 and
 * migration 007's own doc comment for why this is deliberately simpler than
 * `UploadOutboxRepository`: no idempotency key, no retry backoff schedule,
 * no dependency chain. `StatsEventWorker` (apps/desktop) owns the actual
 * push-and-retry timing; this repository only ever answers "what's still
 * PENDING" and "mark these SENT" — an occasional duplicate delivery (a push
 * that succeeded server-side but whose response the kiosk never saw before
 * retrying) over-counts one event by one, which is a far smaller problem
 * than the machinery needed to prevent it for a number that is only ever
 * displayed, never acted on.
 */
export class StatsEventRepository {
  constructor(private db: SqlExecutor) {}

  public enqueue(input: EnqueueStatsEventInput): void {
    this.db.run(
      `INSERT INTO stats_event_outbox (id, type, occurred_at, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.type, input.occurredAt, input.metadata ? JSON.stringify(input.metadata) : null, Date.now()]
    );
  }

  public claimPending(limit = 100): StatsEventItem[] {
    return this.db
      .exec<Record<string, unknown>>(
        `SELECT * FROM stats_event_outbox WHERE status = 'PENDING' ORDER BY created_at LIMIT ?`,
        [limit]
      )
      .map(toItem);
  }

  public markSent(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`UPDATE stats_event_outbox SET status = 'SENT', sent_at = ? WHERE id IN (${placeholders})`, [
      Date.now(),
      ...ids,
    ]);
  }
}
