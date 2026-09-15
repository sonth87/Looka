import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New `device_events.type` value: `EMBEDDING_FAILED` — 2026-09-15, field
 * request: a real test session had every CENTER-step enrollment rejected by
 * the external face-embedding server (`IMAGE_REJECTED`, "Ảnh có 3-4 khuôn
 * mặt"), and that failure was visible only in the kiosk's own local SQLite
 * log — nothing surfaced it centrally the way `UPLOAD_FAILED` already
 * surfaces a failed photo upload. Fired by `embeddingEnroll.ts`'s
 * `applyFailure()` for a DEFINITIVE outcome only — a real rejection
 * (400/409/413/422, `markFailed`) or a network failure that finally gave up
 * after `MAX_ATTEMPTS` (`markGaveUp`) — never for an ordinary in-progress
 * retry, so this table isn't spammed by a single transient network blip
 * that resolves on its own. Same "appended, not used in this migration"
 * pattern as every prior enum-value addition on this column.
 */
export class DeviceEventEmbeddingFailed1821000000000 implements MigrationInterface {
  name = 'DeviceEventEmbeddingFailed1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'EMBEDDING_FAILED'`,
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
        'CAPTURE_TRIGGERED', 'EMBEDDING_ENROLLED'
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
