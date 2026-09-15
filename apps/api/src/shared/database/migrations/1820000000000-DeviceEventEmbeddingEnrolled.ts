import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New `device_events.type` value: `EMBEDDING_ENROLLED` — 2026-09-15, face-
 * embedding-server-integration-plan.md. Fired by the kiosk (desktop main
 * process, `embeddingEnroll.ts`) right after a CENTER-step capture is
 * successfully registered with the external "Attendance — Face Enrollment
 * API" (`http://10.20.107.17:8000`), so that record lands centrally in this
 * API's own Postgres — the external server itself owns the embedding
 * vector, but until now nothing wrote even a *reference* to that enrollment
 * anywhere queryable from the CMS/backend, only the kiosk's own local
 * SQLite outbox (`embedding_enrollments`, `packages/database`'s migration
 * 011). `metadata` carries `{ sessionId, stepId, attempt, userCode,
 * embeddingId, sourceImagePath }` — the same fields the local outbox row
 * gets on success, just also pushed up like every other `device_events`
 * type already is. Same "appended, not used in this migration" pattern as
 * every prior enum-value addition on this column — see
 * 1792000000000-DeviceEventStartedAndTriggered.
 */
export class DeviceEventEmbeddingEnrolled1820000000000 implements MigrationInterface {
  name = 'DeviceEventEmbeddingEnrolled1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'EMBEDDING_ENROLLED'`,
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
        'VIDEO_STATUS', 'ATTEMPT_SUPERSEDED', 'SESSION_STARTED',
        'CAPTURE_TRIGGERED'
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
