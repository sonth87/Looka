import type { Migration } from './index.js';

/**
 * Local video recorded alongside a capture session — see
 * docs/plans/multi-camera-device-management-discussion.md §3.1. A separate
 * table from `upload_outbox`, not a new `kind` value there: video has no
 * "stage, then approve" gate the way a photo does (there is no reason yet to
 * hold a recording back from anything, since nothing uploads it — see below),
 * and mixing two lifecycles into one table just to reuse its columns would
 * make every future outbox change have to reason about a case it does not
 * apply to.
 *
 * No upload/status/retry columns here on purpose: whether video ever leaves
 * the kiosk (upload to fs-core vs. local-only + auto-delete) is still an open
 * question in that doc's §4 (#3) — this only records what was captured and
 * where it lives on disk, independent of that still-open decision.
 */
export const MIGRATION_006_CAPTURE_STREAMS: Migration = {
  version: 6,
  name: 'capture-streams',
  up: [
    `CREATE TABLE IF NOT EXISTS capture_streams (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      camera_id     TEXT NOT NULL,
      local_path    TEXT NOT NULL,
      mime_type     TEXT NOT NULL DEFAULT 'video/webm',
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER,
      created_at    INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_capture_streams_session ON capture_streams(session_id)`,
  ],
};
