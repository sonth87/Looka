import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Local-first bytes storage for `photo_variants` — the photo-review module's
 * own counterpart to the `capture` module's `upload_outbox` (see
 * `1787300000000-InitCaptureSchema.ts`), NOT a reuse of that table.
 *
 * `upload_outbox.photo_id` is a NOT NULL FK straight into `photos` (owned by
 * `capture`), so pointing a row at a `photo_variants` id instead would mean
 * either a second nullable FK column bolted onto a table this module does
 * not own, or relaxing `photo_id` to nullable and teaching every existing
 * reader (`PhotoService`, `UploadWorkerService`) to handle a row with no
 * photo — both cut across the "no structural dependency on `capture`"
 * boundary this module has kept everywhere else (see
 * `photo-review.module.ts`'s own doc comment). A parallel table, owned here,
 * referencing only `photo_variants` (already owned by this module), keeps
 * that boundary intact at the cost of a duplicated shape — the same
 * trade-off this module already makes for `resolveSessionContext` etc.
 * duplicating logic `PhotoService`/`SessionService` own instead of importing
 * them.
 *
 * Differences from `upload_outbox`, both deliberate:
 *  - `tenant_name`: a variant upload may target a kiosk device's own tenant
 *    (`PhotoReviewService.uploadCardBytes`/`storeVariantBytesLocalFirst` use
 *    `FileStorageService.clientForTenant`) — recorded per row so the cron
 *    (`VariantUploadWorkerService`, which has no other way to know a job's
 *    tenant) can replay the same upload target on retry.
 *  - no `approved_at` gate: unlike a captured photo (queued only after an
 *    operator/kiosk approves the whole session), a variant's bytes are
 *    already the result of a reviewer-triggered action (reprocess/AI
 *    edit/upload) by the time they exist — nothing further needs to approve
 *    the push to fs-core.
 */
export class VariantUploadOutbox1803000000000 implements MigrationInterface {
  name = 'VariantUploadOutbox1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "variant_upload_outbox_status_enum" AS ENUM ('PENDING', 'SENDING', 'UPLOADED', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "variant_upload_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "variant_id" uuid NOT NULL,
        "idem_key" character varying(255) NOT NULL,
        "virtual_path" text NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "content" bytea NOT NULL,
        "tenant_name" character varying(255),
        "status" "variant_upload_outbox_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "next_retry_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_variant_upload_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_variant_upload_outbox_idem_key" UNIQUE ("idem_key"),
        CONSTRAINT "FK_variant_upload_outbox_variant" FOREIGN KEY ("variant_id")
          REFERENCES "photo_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_variant_upload_outbox_created_at" ON "variant_upload_outbox" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_variant_upload_outbox_variant_id" ON "variant_upload_outbox" ("variant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_variant_upload_outbox_status" ON "variant_upload_outbox" ("status")`,
    );
    // Mirrors `upload_outbox`'s own `IDX_upload_outbox_due` — the exact
    // predicate `VariantUploadWorkerService.claimNext()` filters on.
    await queryRunner.query(`
      CREATE INDEX "IDX_variant_upload_outbox_due" ON "variant_upload_outbox" ("status", "next_retry_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "variant_upload_outbox"`);
    await queryRunner.query(`DROP TYPE "variant_upload_outbox_status_enum"`);
  }
}
