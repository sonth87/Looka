import type { Migration } from './index.js';

/**
 * Durable upload queue.
 *
 * A capture is finished once its bytes are on local disk and a row exists here,
 * both committed together. The person in front of the camera never waits for the
 * network, and a power cut costs at most the frame still in memory.
 *
 * idem_key is UNIQUE and derived from what is being uploaded rather than
 * generated randomly, so re-enqueuing the same capture after a crash is a
 * no-op instead of a second copy.
 */
export const MIGRATION_003_UPLOAD_OUTBOX: Migration = {
  version: 3,
  name: 'upload-outbox',
  up: [
    `CREATE TABLE IF NOT EXISTS upload_outbox (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      kind          TEXT NOT NULL,
      local_path    TEXT NOT NULL,
      virtual_path  TEXT NOT NULL,
      mime_type     TEXT NOT NULL DEFAULT 'image/jpeg',
      sha256        TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      metadata      TEXT,
      idem_key      TEXT NOT NULL UNIQUE,
      upload_id     TEXT NOT NULL,
      depends_on    TEXT REFERENCES upload_outbox(id),
      status        TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SENDING','UPLOADED','DONE','FAILED_PERMANENT')),
      attempts      INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      last_error    TEXT,
      fs_file_id    TEXT,
      fs_status     TEXT,
      fs_status_at  INTEGER,
      created_at    INTEGER NOT NULL,
      done_at       INTEGER
    )`,

    // The worker only ever looks for due work; a partial index keeps that scan
    // proportional to the backlog rather than to everything ever uploaded.
    `CREATE INDEX IF NOT EXISTS idx_outbox_due
       ON upload_outbox(next_retry_at) WHERE status = 'PENDING'`,

    // Files awaiting the server-side scan, so a stuck one can be surfaced.
    `CREATE INDEX IF NOT EXISTS idx_outbox_awaiting_scan
       ON upload_outbox(fs_status_at) WHERE status = 'UPLOADED'`,

    `CREATE INDEX IF NOT EXISTS idx_outbox_session ON upload_outbox(session_id)`,
  ],
};
