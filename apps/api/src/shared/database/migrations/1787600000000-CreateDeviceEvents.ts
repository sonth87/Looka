import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-device event log for admin-side stats — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4. `campaign_id`
 * is denormalized (not joined through `device_id` at query time) because
 * every stats query groups by campaign first — see
 * DeviceEventService.campaignStats. No `FK ... ON DELETE CASCADE` from
 * `device_id`/`campaign_id` to their tables: this is a log, and a device or
 * campaign being deleted later must not silently erase the history of what
 * it did.
 */
export class CreateDeviceEvents1787600000000 implements MigrationInterface {
  name = 'CreateDeviceEvents1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "device_events_type_enum" AS ENUM (
        'SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE', 'CB_HELP_INTERVENTION'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "device_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "device_id" uuid NOT NULL,
        "campaign_id" uuid NOT NULL,
        "type" "device_events_type_enum" NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "metadata" jsonb,
        CONSTRAINT "PK_device_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_device_events_device_id" ON "device_events" ("device_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_device_events_campaign_id" ON "device_events" ("campaign_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_device_events_type" ON "device_events" ("campaign_id", "type")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "device_events"`);
    await queryRunner.query(`DROP TYPE "device_events_type_enum"`);
  }
}
