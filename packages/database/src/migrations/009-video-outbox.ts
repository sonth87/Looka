import type { Migration } from './index.js';

/**
 * Documents that `upload_outbox.kind` supports `'video'` — no code change was
 * needed to allow it. The column has no CHECK constraint (migration 003 only
 * constrains `status`), so `'video'` rows were already legal; this migration
 * exists to record the decision and add the index that querying by kind now
 * needs, per docs/plans (video-upload-to-file-service, 2026-09-08).
 *
 * `step_id` for a video row is the recording's own id
 * (`capture_streams.id`), not a camera/role id — see
 * `apps/desktop/src/main/uploads.ts`'s `approveSessionUpload()`, which is the
 * only writer of `kind = 'video'` rows. That choice is what keeps
 * `UploadOutboxRepository.approveSession()`'s "highest attempt per
 * (kind, step_id) wins, delete the rest" grouping from deleting one of a
 * session's several simultaneous-mode videos: each recording gets its own
 * step_id, so each falls into its own group of one.
 */
export const MIGRATION_009_VIDEO_OUTBOX: Migration = {
  version: 9,
  name: 'video-outbox',
  up: [`CREATE INDEX IF NOT EXISTS idx_upload_outbox_kind_session ON upload_outbox (kind, session_id)`],
};
