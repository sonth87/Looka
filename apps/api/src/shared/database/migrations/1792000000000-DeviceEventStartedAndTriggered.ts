import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two new `device_events.type` values, foundational for the 2026-09-08
 * scope (see docs/plans/campaign-config-sso-card-photo-discussion.md §3.7,
 * §3.8.2): `SESSION_STARTED` (the "đang chụp" / currently-capturing
 * indicator) and `CAPTURE_TRIGGERED` (auto-vs-manual capture statistics).
 * Same "appended, not used in this migration" pattern as every prior
 * enum-value addition on this column — see 1789000000000-AttemptSuperseded.
 */
export class DeviceEventStartedAndTriggered1792000000000 implements MigrationInterface {
  name = 'DeviceEventStartedAndTriggered1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'SESSION_STARTED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'CAPTURE_TRIGGERED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" RENAME TO "device_events_type_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "device_events_type_enum" AS ENUM (
        'SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE',
        'CB_HELP_INTERVENTION', 'SESSION_REPORT', 'PHOTO_STATUS',
        'VIDEO_STATUS', 'ATTEMPT_SUPERSEDED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "device_events"
        ALTER COLUMN "type" TYPE "device_events_type_enum"
        USING "type"::text::"device_events_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "device_events_type_enum_old"`);
  }
}
