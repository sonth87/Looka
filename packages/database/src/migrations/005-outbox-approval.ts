import type { Migration } from './index.js';

/**
 * Approval gate for the upload outbox.
 *
 * A capture used to become eligible for background upload the instant
 * `queueCapture()` wrote its row (see migration 003's own doc comment). The
 * desktop app now stages a session's captures locally first and only makes
 * them eligible once the operator reviews and confirms — see
 * UploadOutboxRepository.approveSession() and apps/desktop's
 * `session:approveUpload` IPC handler.
 *
 * `approved_at` is that gate: NULL means "captured and queued, but the
 * operator has not confirmed this session yet — claimDue() must not pick it
 * up." A timestamp means the operator confirmed at that time, which doubles
 * as the history this feature needs ("was this session's data actually sent,
 * and when") without a second table — paired with the existing `done_at` for
 * when the upload itself actually finished.
 *
 * Deliberately a new nullable column rather than a new `status` value (e.g.
 * 'STAGED'): `status` carries a CHECK constraint enumerating its legal values
 * (migration 003), and SQLite has no ALTER TABLE support for widening a CHECK
 * constraint — only a full table rebuild (rename, recreate, copy, drop) would
 * do it. For this table that rebuild is meaningfully riskier than usual:
 * `depends_on` is a self-referential foreign key, `NodeSqliteDriver` turns on
 * `PRAGMA foreign_keys = ON`, and SQLite treats that pragma as a no-op inside
 * an open transaction — which every migration here always runs in (see
 * `runMigrations`). There is no safe point in this migration framework to
 * disable FK enforcement for the rebuild and re-enable it after. A plain
 * additive column carries none of that risk, matches migration 004's own
 * style (a single nullable column, its own independent CHECK), and needs no
 * new branch anywhere that already pattern-matches on `OutboxStatus` — the
 * one new predicate is threaded only into `claimDue()`.
 */
export const MIGRATION_005_OUTBOX_APPROVAL: Migration = {
  version: 5,
  name: 'outbox-approval',
  up: [`ALTER TABLE upload_outbox ADD COLUMN approved_at INTEGER`],
};
