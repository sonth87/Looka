import type { Migration } from './index.js';

/**
 * Local "sinh viên đã chụp" index (2026-09-08 "student gallery" feature) —
 * one row per approved session that carries a real student identity. Kept
 * as its own table rather than reused from anywhere else: `upload_outbox`
 * is keyed on capture jobs (photo/video), not sessions, and the only other
 * local session record (`SessionRepository`'s generic `app_settings` KV
 * blob store) supports single-key lookup only, never listing — the whole
 * point of this table is to make "list recent students" and "list this
 * student's sessions" cheap, indexed queries for the kiosk's own hidden
 * `#recent-students` screen, so it works fully offline without depending on
 * the central API.
 *
 * One row per session, not per student: a student captured on 3 different
 * days has 3 rows here, same as `sessions` itself — `subject_code` is
 * indexed separately precisely so both "distinct students" and "this
 * student's history" are cheap without denormalising one into the other.
 */
export const MIGRATION_010_CAPTURED_STUDENTS: Migration = {
  version: 10,
  name: 'captured-students',
  up: [
    `CREATE TABLE IF NOT EXISTS captured_students (
      session_id     TEXT PRIMARY KEY,
      subject_code   TEXT NOT NULL,
      subject_name   TEXT,
      class_name     TEXT,
      major          TEXT,
      academic_year  TEXT,
      workflow_id    TEXT,
      photo_count    INTEGER NOT NULL DEFAULT 0,
      approved_at    INTEGER NOT NULL,
      created_at     INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_captured_students_subject_code ON captured_students(subject_code)`,
    `CREATE INDEX IF NOT EXISTS idx_captured_students_approved_at ON captured_students(approved_at)`,
  ],
};
