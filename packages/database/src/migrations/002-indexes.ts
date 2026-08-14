import type { Migration } from './index.js';

/**
 * Indexes and the duplicate-attendance constraint.
 *
 * The original schema had no index at all: getLastAttendance scanned the whole
 * table, and duplicate prevention lived only in application code — two frames
 * processed concurrently could both pass the cooldown check and both insert.
 * `uq_attendance_once` makes that race impossible at the storage layer.
 *
 * business_day is stored rather than derived at query time so the "night shift
 * ending at 02:00 belongs to the previous working day" rule is fixed at write
 * time and cannot drift when the rule is later reconfigured.
 */
export const MIGRATION_002_INDEXES: Migration = {
  version: 2,
  name: 'indexes-and-duplicate-constraint',
  up: [
    `ALTER TABLE attendance_records ADD COLUMN business_day TEXT`,

    // Backfill existing rows using UTC date; pre-existing records predate the
    // business-day rule, so any consistent value is acceptable here.
    `UPDATE attendance_records
       SET business_day = date(timestamp / 1000, 'unixepoch')
     WHERE business_day IS NULL`,

    `CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_once
       ON attendance_records(person_id, type, business_day)`,

    `CREATE INDEX IF NOT EXISTS idx_attendance_person_time
       ON attendance_records(person_id, timestamp DESC)`,

    `CREATE INDEX IF NOT EXISTS idx_attendance_sync
       ON attendance_records(sync_status)`,

    `CREATE INDEX IF NOT EXISTS idx_sync_queue_ready
       ON sync_queue(status, next_retry_at)`,

    `CREATE INDEX IF NOT EXISTS idx_embeddings_profile
       ON face_embeddings(face_profile_id)`,

    // Recognition loads only ACTIVE profiles of a compatible model; this index
    // is shaped for exactly that query.
    `CREATE INDEX IF NOT EXISTS idx_profiles_active_model
       ON face_profiles(status, model_family, model_version, preprocessing_version)`,

    `CREATE INDEX IF NOT EXISTS idx_profiles_person
       ON face_profiles(person_id, status)`,

    `CREATE INDEX IF NOT EXISTS idx_samples_profile
       ON face_samples(face_profile_id)`,

    `CREATE INDEX IF NOT EXISTS idx_audit_type_time
       ON audit_events(type, timestamp)`,
  ],
};
