import type { Migration } from './index.js';

/**
 * Local reference table for the external Face Enrollment API integration
 * (`http://10.20.107.17:8000`) — see
 * docs/plans/face-embedding-server-integration-plan.md §3 for why this is a
 * *reference* table, not a vector store: the external server extracts,
 * stores and matches embeddings itself and never returns one, so unlike
 * `face_embeddings` (migration 001, the old MOCK-model pipeline this
 * integration leaves untouched) there is no `vector_blob` here at all —
 * only enough to know which server-side embedding a given local capture
 * produced, and to drive the retry queue for enrollment calls that failed
 * because the server was unreachable (§5.1's last bullet, §6's "Mất mạng"
 * row).
 *
 * `step_id` is deliberately generic — a `CaptureStep.id` (`@face/core`'s
 * `packages/core/src/types/workflow.ts`), not hardcoded to any one step —
 * even though the current integration only ever calls `enrollFace()` for
 * the CENTER step (2026-09-10 product decision: a narrower first pass than
 * the plan's original "one call per step, 5 steps" design). Recording which
 * step/angle produced each embedding from day one means enrolling
 * additional angles later is just another call through the same pathway for
 * a different `step_id` — no schema change needed when that happens.
 *
 * One row per `(session_id, step_id, attempt)`, mirroring
 * `upload_outbox`'s own `<sessionId>:<stepId>:<attempt>` idempotency
 * convention (migration 003/008) — a retake produces a genuinely different
 * captured image, and the external server itself does not overwrite on a
 * repeat `POST` ("Mỗi lần gọi POST tạo bản ghi mới, không ghi đè" — plan
 * §1), so each attempt is tracked and sent as its own enrollment rather than
 * one row being mutated in place.
 */
export const MIGRATION_011_EMBEDDING_ENROLLMENTS: Migration = {
  version: 11,
  name: 'embedding-enrollments',
  up: [
    `CREATE TABLE IF NOT EXISTS embedding_enrollments (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT NOT NULL,
      step_id              TEXT NOT NULL,
      attempt              INTEGER NOT NULL DEFAULT 1,
      user_code            TEXT NOT NULL,
      local_image_path     TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','SENDING','DONE','FAILED')),
      embedding_id         INTEGER,
      source_image_path    TEXT,
      attempts             INTEGER NOT NULL DEFAULT 0,
      next_retry_at        INTEGER,
      last_error           TEXT,
      failure_kind         TEXT,
      conflict_user_code   TEXT,
      conflict_similarity  REAL,
      created_at           INTEGER NOT NULL,
      done_at              INTEGER
    )`,

    // The retry worker only ever looks for due work; a partial index keeps
    // that scan proportional to the backlog rather than to every enrollment
    // ever attempted — same reasoning as upload_outbox's idx_outbox_due
    // (migration 003).
    `CREATE INDEX IF NOT EXISTS idx_embedding_enrollments_due
       ON embedding_enrollments(next_retry_at) WHERE status = 'PENDING'`,

    `CREATE INDEX IF NOT EXISTS idx_embedding_enrollments_session ON embedding_enrollments(session_id)`,
  ],
};
