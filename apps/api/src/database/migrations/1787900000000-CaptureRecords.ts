import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 11 — one record store for both capture paths (kiosk + web). See
 * docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md
 * §3 (D1-D3) for the design and §4 for the exact shape this mirrors.
 *
 * Additive only: every new column is nullable or carries a default, so
 * existing web-path rows (which all become `source = 'WEB'`) keep working
 * completely untouched.
 */
export class CaptureRecords1787900000000 implements MigrationInterface {
  name = 'CaptureRecords1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // sessions: which path produced it, and — for the kiosk path — which
    // device/campaign, plus the kiosk's own clock for when the run started
    // and when the operator approved it.
    await queryRunner.query(
      `CREATE TYPE "sessions_source_enum" AS ENUM ('WEB', 'KIOSK')`,
    );
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD COLUMN "source" "sessions_source_enum" NOT NULL DEFAULT 'WEB',
        ADD COLUMN "device_id" uuid,
        ADD COLUMN "campaign_id" uuid,
        ADD COLUMN "captured_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "approved_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "workflow_id" character varying(100)
    `);
    // ON DELETE SET NULL, not CASCADE: a device or campaign being removed
    // later must not take a kiosk's capture history down with it - the
    // record just stops being attributable to a live device/campaign.
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD CONSTRAINT "FK_sessions_device" FOREIGN KEY ("device_id")
          REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD CONSTRAINT "FK_sessions_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_device_id" ON "sessions" ("device_id")`,
    );
    // Descending on captured_at: the sessions list (GET /v1/sessions) orders
    // "most recent first" within a campaign, and this index serves that scan
    // directly instead of a sort step.
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_campaign_captured_at" ON "sessions" ("campaign_id", "captured_at" DESC)`,
    );

    // photos: the kiosk's step/camera identity plus the upload-lifecycle
    // timestamps the web outbox never needed before this (it always uploads
    // within seconds of capture; the kiosk stages locally until approval and
    // reports each milestone separately - see PHOTO_STATUS in §5 of the plan).
    await queryRunner.query(`
      ALTER TABLE "photos"
        ADD COLUMN "step_type" character varying(20),
        ADD COLUMN "camera_role" character varying(10),
        ADD COLUMN "captured_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "uploaded_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "ready_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "fs_status_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "local_status" character varying(20),
        ADD COLUMN "upload_error" text
    `);

    // upload_outbox (web path): aligning with decision 1 (kiosk keeps only
    // the last attempt per step) means the web path also needs an approval
    // gate before claimNext() may send a photo - see A.4.
    await queryRunner.query(`
      ALTER TABLE "upload_outbox"
        ADD COLUMN "approved_at" TIMESTAMP WITH TIME ZONE
    `);
    // Replaces IDX_upload_outbox_due with the same due-work predicate plus
    // the new approval gate, so an unapproved row can never be claimed and
    // never bloats the partial index either.
    await queryRunner.query(`DROP INDEX "IDX_upload_outbox_due"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_upload_outbox_due" ON "upload_outbox" ("status", "next_retry_at")
        WHERE "status" IN ('PENDING', 'SENDING') AND "approved_at" IS NOT NULL
    `);

    // device_events: two new self-sufficient event types carrying capture
    // records (see the plan's §5 contract). Values are only appended here,
    // never used in the same migration/transaction - a freshly added enum
    // label is not visible to other statements until the transaction that
    // added it commits, so PostgreSQL forbids using it earlier.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'SESSION_REPORT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'PHOTO_STATUS'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL has no ALTER TYPE ... DROP VALUE; narrowing the enum back
    // means rebuilding the type from scratch and re-pointing the column at
    // it. This intentionally FAILS if any device_events row already carries
    // one of the two new values - that is the correct behaviour: rolling
    // back past data that depends on the wider type must not silently drop
    // or remap that data.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" RENAME TO "device_events_type_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "device_events_type_enum" AS ENUM (
        'SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE', 'CB_HELP_INTERVENTION'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "device_events"
        ALTER COLUMN "type" TYPE "device_events_type_enum"
        USING "type"::text::"device_events_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "device_events_type_enum_old"`);

    await queryRunner.query(`DROP INDEX "IDX_upload_outbox_due"`);
    await queryRunner.query(
      `ALTER TABLE "upload_outbox" DROP COLUMN "approved_at"`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_upload_outbox_due" ON "upload_outbox" ("status", "next_retry_at")
        WHERE "status" IN ('PENDING', 'SENDING')
    `);

    await queryRunner.query(`
      ALTER TABLE "photos"
        DROP COLUMN "step_type",
        DROP COLUMN "camera_role",
        DROP COLUMN "captured_at",
        DROP COLUMN "uploaded_at",
        DROP COLUMN "ready_at",
        DROP COLUMN "fs_status_at",
        DROP COLUMN "local_status",
        DROP COLUMN "upload_error"
    `);

    await queryRunner.query(`DROP INDEX "IDX_sessions_campaign_captured_at"`);
    await queryRunner.query(`DROP INDEX "IDX_sessions_device_id"`);
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_sessions_campaign"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_sessions_device"`,
    );
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN "source",
        DROP COLUMN "device_id",
        DROP COLUMN "campaign_id",
        DROP COLUMN "captured_at",
        DROP COLUMN "approved_at",
        DROP COLUMN "workflow_id"
    `);
    await queryRunner.query(`DROP TYPE "sessions_source_enum"`);
  }
}
