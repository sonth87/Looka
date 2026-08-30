import type { Migration } from './index.js';

/**
 * Local queue for admin-side stats events — see
 * docs/plans/multi-camera-device-management-discussion.md §3.3/§3.4. Much
 * simpler than `upload_outbox` on purpose: an event is a count, not a
 * durable artifact a specific person is waiting on, so there is no
 * idempotency key, no dependency chain, no backoff schedule stored here —
 * see StatsEventRepository's own doc comment for why an occasional
 * duplicate push is an acceptable cost for that simplicity.
 */
export const MIGRATION_007_STATS_EVENTS: Migration = {
  version: 7,
  name: 'stats-events',
  up: [
    `CREATE TABLE IF NOT EXISTS stats_event_outbox (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      occurred_at  INTEGER NOT NULL,
      metadata     TEXT,
      status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT')),
      created_at   INTEGER NOT NULL,
      sent_at      INTEGER
    )`,

    `CREATE INDEX IF NOT EXISTS idx_stats_events_pending
       ON stats_event_outbox(created_at) WHERE status = 'PENDING'`,
  ],
};
