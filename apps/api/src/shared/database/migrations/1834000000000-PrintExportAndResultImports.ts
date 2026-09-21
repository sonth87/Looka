import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P6-Giai đoạn 4 — `13-features-and-2-blockers-plan-2026-09-18.md` §4
 * (features 2/3/4/5: auto-populate a batch from its campaign, per-card
 * export date, print-result upload, status transitions). See that
 * section's own "§4.0 Trạng thái mới và cách gỡ từng bẫy" for the full
 * reasoning behind each change below.
 *
 * 1. `print_items` — new `EXPORTED` status (between `RENDERED` and
 *    `PRINTED`, feature 3/Bẫy 1) + `exported_at` column (feature 3).
 *    Deliberately NOT added to `PRINT_ITEM_INACTIVE_STATUSES` — an
 *    EXPORTED item is still "in flight", it must keep holding its
 *    `set_id` slot in `UQ_print_items_set_id_active`.
 *
 * 2. `print_item_events.source` — widened `varchar(12)` → `varchar(16)`
 *    AND its CHECK extended to add `RESULT_UPLOAD` (Bẫy 3): the value
 *    `'RESULT_UPLOAD'` is 13 characters, one past the old column width —
 *    widening only the CHECK without the column would produce a
 *    `value too long for type character varying(12)` runtime error on
 *    first use that looks exactly like a broken CHECK, so both must
 *    change in the same migration.
 *
 * 3. `print_batches.last_exported_at` — display-only mirror of the most
 *    recent per-item `exported_at` for this batch (feature 3).
 *
 * 4. `print_result_imports` — mirrors `campaign_subject_imports` (same
 *    shape/reasoning: one row per upload event, `created_at` doubles as
 *    the upload date). Real FK to `print_batches` (same-module, same
 *    convention `print_items.batch_id` already uses) — `ON DELETE CASCADE`
 *    since an import row has no meaning once its batch is gone.
 */
export class PrintExportAndResultImports1834000000000 implements MigrationInterface {
  name = 'PrintExportAndResultImports1834000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "print_items"
        DROP CONSTRAINT "CHK_print_items_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "print_items"
        ADD CONSTRAINT "CHK_print_items_status" CHECK ("status" IN (
          'PENDING', 'RENDERED', 'EXPORTED', 'QUEUED', 'PRINTING', 'PRINTED',
          'FAILED', 'REPRINT_REQUESTED', 'CANCELLED'
        ))
    `);
    await queryRunner.query(`
      ALTER TABLE "print_items"
        ADD COLUMN "exported_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        DROP CONSTRAINT "CHK_print_item_events_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        ALTER COLUMN "source" TYPE character varying(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        ADD CONSTRAINT "CHK_print_item_events_source" CHECK (
          "source" IN ('SYSTEM', 'PRINT_AGENT', 'MANUAL', 'RESULT_UPLOAD')
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "print_batches"
        ADD COLUMN "last_exported_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      CREATE TABLE "print_result_imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "batch_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "fs_file_id" character varying(255),
        "uploaded_by_user_id" uuid,
        "status" character varying(10) NOT NULL DEFAULT 'PROCESSING',
        "total_rows" integer NOT NULL DEFAULT 0,
        "matched_rows" integer NOT NULL DEFAULT 0,
        "printed_rows" integer NOT NULL DEFAULT 0,
        "failed_rows" integer NOT NULL DEFAULT 0,
        "unmatched_rows" integer NOT NULL DEFAULT 0,
        "error_report_fs_file_id" character varying(255),
        "failure_reason" text,
        CONSTRAINT "PK_print_result_imports" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_print_result_imports_status" CHECK ("status" IN ('PROCESSING', 'DONE', 'FAILED')),
        CONSTRAINT "FK_print_result_imports_batch" FOREIGN KEY ("batch_id")
          REFERENCES "print_batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_print_result_imports_batch_id" ON "print_result_imports" ("batch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "print_result_imports"`);

    await queryRunner.query(`
      ALTER TABLE "print_batches"
        DROP COLUMN "last_exported_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        DROP CONSTRAINT "CHK_print_item_events_source"
    `);
    // Rows written with source = 'RESULT_UPLOAD' cannot round-trip through
    // this down migration — same "no data recovery, shape only" precedent
    // `1832000000000-DropCampaignKioskAssignments.ts` documents for its own
    // down(). The narrower CHECK/column width below would otherwise reject
    // them.
    await queryRunner.query(
      `DELETE FROM "print_item_events" WHERE "source" = 'RESULT_UPLOAD'`,
    );
    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        ALTER COLUMN "source" TYPE character varying(12)
    `);
    await queryRunner.query(`
      ALTER TABLE "print_item_events"
        ADD CONSTRAINT "CHK_print_item_events_source" CHECK ("source" IN ('SYSTEM', 'PRINT_AGENT', 'MANUAL'))
    `);

    await queryRunner.query(`
      ALTER TABLE "print_items"
        DROP COLUMN "exported_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "print_items"
        DROP CONSTRAINT "CHK_print_items_status"
    `);
    // Rows left at status = 'EXPORTED' cannot round-trip either — same
    // reasoning as above.
    await queryRunner.query(
      `UPDATE "print_items" SET "status" = 'RENDERED' WHERE "status" = 'EXPORTED'`,
    );
    await queryRunner.query(`
      ALTER TABLE "print_items"
        ADD CONSTRAINT "CHK_print_items_status" CHECK ("status" IN (
          'PENDING', 'RENDERED', 'QUEUED', 'PRINTING', 'PRINTED', 'FAILED',
          'REPRINT_REQUESTED', 'CANCELLED'
        ))
    `);
  }
}
