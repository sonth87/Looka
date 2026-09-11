import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Chụp lại sau khi đã lưu" (2026-09-08 post-save retake feature — see
 * docs/ROADMAP.md). A kiosk retake that happens AFTER the session was
 * already approved once needs to tell this API to drop the stale
 * `photos`/`session_videos` row it is replacing — `ATTEMPT_SUPERSEDED` is
 * that signal. See `CaptureReportService.applyAttemptSuperseded()` for what
 * it does with it.
 *
 * No schema change beyond the enum value: the row it deletes already exists
 * in `photos`/`session_videos` from an earlier `SESSION_REPORT`/`VIDEO_STATUS`.
 */
export class AttemptSuperseded1789000000000 implements MigrationInterface {
  name = 'AttemptSuperseded1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Appended, not used in this same migration/transaction — see
    // 1787900000000-CaptureRecords.ts's identical note on why.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'ATTEMPT_SUPERSEDED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Same "rebuild rather than narrow" approach as CaptureRecords'/
    // SessionVideos' down() — and the same intentional failure if any row
    // already used the value, for the same reason: rolling back past data
    // that depends on the wider type must not silently drop or remap it.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" RENAME TO "device_events_type_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "device_events_type_enum" AS ENUM (
        'SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE',
        'CB_HELP_INTERVENTION', 'SESSION_REPORT', 'PHOTO_STATUS', 'VIDEO_STATUS'
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
