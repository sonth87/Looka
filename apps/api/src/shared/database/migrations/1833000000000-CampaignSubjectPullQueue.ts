import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3-Giai đoạn 3 — `13-features-and-2-blockers-plan-2026-09-18.md` §3.1/§3.2/
 * §3.3 (feature 1: pull-all-from-API, feature 6: mark-printed, feature 7:
 * dynamic group stats):
 *
 * 1. `campaign_subject_imports` — extended with `source`/`source_detail`/
 *    `finished_at` and a widened `status` (see that entity's own doc
 *    comment for the two lifecycles this now covers). Reused rather than a
 *    new table specifically because `campaign_subjects.import_id` is
 *    `NOT NULL` with an FK here — a pull cannot write ANY roster row
 *    without an import row to point at, so extending this table is the only
 *    way that does not also loosen that constraint.
 *
 * 2. `campaign_subject_import_chunks` — the durable 2-tier queue's payload
 *    table (Postgres, not Redis/BullMQ — deliberately, to avoid a silent
 *    data-loss window during a mid-pull crash; see the plan's own §3.1
 *    "Kiến trúc hàng đợi 2 tầng" for the full reasoning). No `updated_at`:
 *    `next_retry_at` doubles as the "claimed at" marker a stuck-job sweep
 *    reads (`CampaignSubjectPullStuckJobRecoveryWorker` sets it to
 *    `now() + 10 minutes` at claim time, see that worker's own doc
 *    comment), so a dedicated timestamp column would be redundant.
 *
 * 3. `campaign_subjects.printed_at`/`printed_batch_id` (feature 6) — set
 *    later, by the print-result-upload flow (Giai đoạn 4), never by a
 *    roster import/pull. No FK on `printed_batch_id` — cross-module
 *    pointer into `print`'s `print_batches`, same no-FK-across-modules
 *    convention `print_items.setId` already documents.
 *
 * 4. Partial indexes `(campaign_id, faculty)`/`(campaign_id, class_name)
 *    WHERE status = 'VALID'` — feature 7's `GROUP BY` only ever reads
 *    `VALID` rows, so a partial index serves it without also indexing
 *    `ERROR`/`DUPLICATE` rows no query groups by.
 *
 * 5. `print_items` currently has NO index on `subject_code` at all —
 *    `IDX_print_items_campaign_subject` serves both feature 7's CTE join
 *    and (later) feature 4's file-upload row matching.
 *
 * 6. `autovacuum_vacuum_scale_factor = 0.05` on `campaign_subjects` — a
 *    24k-row campaign re-synced repeatedly does a full-table `UPDATE` each
 *    time (see the pull-write-worker's upsert), which is exactly the dead
 *    tuple growth pattern the default 20% scale factor under-vacuums for a
 *    table this size.
 */
export class CampaignSubjectPullQueue1833000000000 implements MigrationInterface {
  name = 'CampaignSubjectPullQueue1833000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        DROP CONSTRAINT "CHK_campaign_subject_imports_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        ALTER COLUMN "status" TYPE character varying(14),
        ADD COLUMN "source" character varying(12) NOT NULL DEFAULT 'EXCEL',
        ADD COLUMN "source_detail" jsonb,
        ADD COLUMN "finished_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        ADD CONSTRAINT "CHK_campaign_subject_imports_status" CHECK (
          "status" IN ('PROCESSING', 'PENDING_FETCH', 'FETCHING', 'IMPORTING', 'DONE', 'FAILED')
        ),
        ADD CONSTRAINT "CHK_campaign_subject_imports_source" CHECK (
          "source" IN ('EXCEL', 'EXTERNAL_API')
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_subject_import_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "import_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "chunk_no" integer NOT NULL,
        "row_count" integer NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_retry_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_error" text,
        CONSTRAINT "PK_campaign_subject_import_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_csic_status" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
        CONSTRAINT "UQ_csic_import_chunk" UNIQUE ("import_id", "chunk_no"),
        CONSTRAINT "FK_csic_import" FOREIGN KEY ("import_id")
          REFERENCES "campaign_subject_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_csic_claim" ON "campaign_subject_import_chunks" ("status", "next_retry_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "campaign_subjects"
        ADD COLUMN "printed_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "printed_batch_id" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_subjects_campaign_faculty_valid" ON "campaign_subjects" ("campaign_id", "faculty") WHERE "status" = 'VALID'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_subjects_campaign_class_valid" ON "campaign_subjects" ("campaign_id", "class_name") WHERE "status" = 'VALID'`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_subjects" SET (autovacuum_vacuum_scale_factor = 0.05)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_print_items_campaign_subject" ON "print_items" ("campaign_id", "subject_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_print_items_campaign_subject"`);

    await queryRunner.query(
      `ALTER TABLE "campaign_subjects" RESET (autovacuum_vacuum_scale_factor)`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_campaign_subjects_campaign_class_valid"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_campaign_subjects_campaign_faculty_valid"`,
    );
    await queryRunner.query(`
      ALTER TABLE "campaign_subjects"
        DROP COLUMN "printed_batch_id",
        DROP COLUMN "printed_at"
    `);

    await queryRunner.query(`DROP TABLE "campaign_subject_import_chunks"`);

    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        DROP CONSTRAINT "CHK_campaign_subject_imports_source",
        DROP CONSTRAINT "CHK_campaign_subject_imports_status"
    `);
    // Rows created by an EXTERNAL_API pull cannot round-trip through this
    // down migration — same "no data recovery, shape only" precedent
    // `1832000000000-DropCampaignKioskAssignments.ts` documents for its own
    // down(). The narrower CHECK below would otherwise reject them.
    await queryRunner.query(
      `DELETE FROM "campaign_subject_imports" WHERE "source" = 'EXTERNAL_API'`,
    );
    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        DROP COLUMN "finished_at",
        DROP COLUMN "source_detail",
        DROP COLUMN "source",
        ALTER COLUMN "status" TYPE character varying(10)
    `);
    await queryRunner.query(`
      ALTER TABLE "campaign_subject_imports"
        ADD CONSTRAINT "CHK_campaign_subject_imports_status" CHECK ("status" IN ('PROCESSING', 'DONE', 'FAILED'))
    `);
  }
}
