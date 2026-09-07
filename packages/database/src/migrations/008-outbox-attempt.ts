import type { Migration } from './index.js';

/**
 * Explicit step/attempt columns for the "keep only the last attempt" approval
 * rule — see docs/plans/04-device-management/phase-11-capture-sessions-and-stats
 * §2 decision 1 and §3 D5: `approveSession()` must approve only the row with
 * the highest `attempt` for each `(kind, step_id)` of a session and delete
 * the rest, so a retaken step never uploads both the rejected and the final
 * shot.
 *
 * Both values have existed since migration 003, encoded in `idem_key`
 * (`<sessionId>:<stepId>:<attempt>:<kind>`, written by `queueCapture()`'s
 * template literal) — this migration does not introduce new information, it
 * just gives two pieces of it their own column so `approveSession()`'s
 * grouping query does not have to re-parse a string on every read.
 *
 * Deliberately NOT backfilled for existing rows, and that is safe rather than
 * lazy: `UploadOutboxRepository.toItem()` falls back to parsing `step_id`/
 * `attempt` out of `idem_key` whenever the column is NULL (see
 * `stepIdFromIdemKey`/`attemptFromIdemKey` next to it), and that parse is not
 * a best-effort guess — `sessionId`, `stepId` and `kind` are sanitised with
 * `safeFileToken` (`apps/desktop/src/main/index.ts`) before ever reaching
 * `idem_key`, so none of them can contain the ':' the format splits on. A row
 * written before this migration is therefore exactly as correct under the new
 * grouping logic as one written after it; only reading it costs one string
 * split instead of a column lookup. Writing a backfill UPDATE would mean
 * re-deriving that same split in pure SQL (SQLite has no split-on-nth-
 * delimiter builtin; only nested SUBSTR/INSTR arithmetic), which is strictly
 * more code and more risk for zero behavioural gain over the existing
 * TypeScript fallback.
 */
export const MIGRATION_008_OUTBOX_ATTEMPT: Migration = {
  version: 8,
  name: 'outbox-attempt',
  up: [
    // One column per statement — SQLite's ALTER TABLE does not accept more
    // than one ADD COLUMN clause in a single statement.
    `ALTER TABLE upload_outbox ADD COLUMN step_id TEXT`,
    `ALTER TABLE upload_outbox ADD COLUMN attempt INTEGER`,
  ],
};
