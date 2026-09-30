import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI-edit queue lifecycle rework (2026-09-29 user request — priority for a
 * user-clicked "gen bằng AI" over background/recovery jobs, plus a real
 * restart-recovery sweep; simplified same-day per a follow-up user request,
 * "bỏ PENDING đi" — no separate PENDING status). `photo_variants.status`
 * grows one new value and one rename:
 *
 * - `DRAFT` (new): the variant row exists (created inside the same
 *   transaction as its `photo_review_events` audit row) but has not yet been
 *   claimed onto the `ai-edit`/`ai-edit-background` BullMQ queue. Replaces
 *   `PROCESSING` as the just-created default — see `ai_attempts` below for
 *   why a separate "claimed" state is now needed.
 * - `PROCESSING` (unchanged spelling, widened meaning): claimed and
 *   enqueued/running — OR a retryable failure (the AI service's own
 *   transient 503/504, or this app's own call timing out) sitting here
 *   waiting for the recovery sweep to re-claim it. There is deliberately no
 *   separate status for that second case: at the DB level it is
 *   indistinguishable from (and needs the exact same recovery handling as)
 *   a run that crashed mid-flight, so `PhotoReviewService.-
 *   requeueStuckAiEditVariants` treats both identically — see that
 *   method's own doc comment.
 * - `READY` → renamed to `DONE`: no behavioral difference, renamed only for
 *   symmetry with the rest of this lifecycle's naming. Every reference to
 *   the old name outside this module is unaffected —
 *   `subject_photo_sets.status='READY'`, `print_batches.status IN
 *   ('DRAFT','READY')`, and `photo_variants.fs_status='READY'` are all
 *   separate columns/enums this migration does not touch (confirmed: print
 *   only ever reads `fs_status`/`fs_file_id`, never `photo_variants.status`
 *   — see `print-package.service.ts`).
 * - `FAILED` (unchanged meaning, narrower trigger): now reserved for
 *   permanent/business failures (identity mismatch upstream, forbidden
 *   prompt inputs reaching the job, a missing source, or a retryable error
 *   that already exhausted `AI_EDIT_MAX_ATTEMPTS`) — never auto-retried.
 * - `DISCARDED` (unchanged).
 *
 * `ai_attempts` (new column) is the single source of truth the whole
 * priority/recovery design hangs off: every claim (enqueue) increments it,
 * every terminal write (DONE/FAILED, or a retry-in-place note update) is
 * guarded by `WHERE status = 'PROCESSING' AND ai_attempts = $expected`, so a
 * superseded/stale run (a recovery-sweep retry racing a fresh user
 * re-claim) can never clobber a newer attempt's result — see
 * `PhotoReviewService.enqueueAiEditJob`/`runQueuedAiEditJob`'s own doc
 * comments.
 *
 * `ai_request_params` (new column) durably stores what a BullMQ job's
 * `data.payload` used to be the ONLY copy of (`cfg`/`steps`/`seed` for an
 * `aiEdit()` job) plus the reprocess "promotion snapshot"
 * (`snapshotCurrentVariantId`) — without this, a variant that outlives its
 * Redis job (crash, `FLUSHALL`, TTL eviction) could never be reconstructed
 * by the recovery sweep.
 *
 * `IDX_photo_variants_ai_recovery` is a partial index on exactly the 2
 * "still in flight, worth sweeping" statuses, so
 * `requeueStuckAiEditVariants`'s `updated_at` scan stays index-only even as
 * the table grows — the large majority of rows settle into DONE/FAILED/
 * DISCARDED and would otherwise dominate a plain index on `updated_at`.
 */
export class PhotoVariantAiQueueLifecycle1841000000000 implements MigrationInterface {
  name = 'PhotoVariantAiQueueLifecycle1841000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "photo_variants" DROP CONSTRAINT "CHK_photo_variants_status"`,
    );

    await queryRunner.query(
      `UPDATE "photo_variants" SET "status" = 'DONE' WHERE "status" = 'READY'`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ADD CONSTRAINT "CHK_photo_variants_status" CHECK ("status" IN ('DRAFT', 'PROCESSING', 'DONE', 'FAILED', 'DISCARDED'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ADD COLUMN "ai_request_params" jsonb NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ADD COLUMN "ai_attempts" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_photo_variants_ai_recovery" ON "photo_variants" ("updated_at") WHERE "status" IN ('DRAFT', 'PROCESSING')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_photo_variants_ai_recovery"`);

    await queryRunner.query(
      `ALTER TABLE "photo_variants" DROP COLUMN "ai_attempts"`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" DROP COLUMN "ai_request_params"`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ALTER COLUMN "status" SET DEFAULT 'PROCESSING'`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" DROP CONSTRAINT "CHK_photo_variants_status"`,
    );

    // Best-effort reverse mapping — DRAFT has no equivalent in the old
    // 4-value enum; FAILED is the closest safe meaning ("not usable, needs a
    // human to re-trigger"), same as what a downgraded app would do with it
    // going forward anyway.
    await queryRunner.query(
      `UPDATE "photo_variants" SET "status" = 'READY' WHERE "status" = 'DONE'`,
    );
    await queryRunner.query(
      `UPDATE "photo_variants" SET "status" = 'FAILED' WHERE "status" = 'DRAFT'`,
    );

    await queryRunner.query(
      `ALTER TABLE "photo_variants" ADD CONSTRAINT "CHK_photo_variants_status" CHECK ("status" IN ('PROCESSING', 'READY', 'FAILED', 'DISCARDED'))`,
    );
  }
}
