import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens `camera_role` on `session_videos` (varchar(20)) and `photos`
 * (varchar(10)) — 2026-09-09 field bug. Both entities' own doc comments say
 * this column falls back to the raw physical camera device id when no role
 * mapping applies (`stream?.cameraId` in apps/desktop's `uploads.ts`), and a
 * Chromium `MediaDeviceInfo.deviceId` is a long hashed string (commonly
 * 60-100+ characters) — nowhere close to fitting in either limit. The write
 * failed outright (`value too long for type character varying(20)`),
 * dropping the whole `session_videos` row (and would drop a `photos` row
 * the same way, on a kiosk with any camera not explicitly role-mapped).
 * 255 is a generous, ordinary "just a string" ceiling — no known device id
 * format gets remotely close to it.
 */
export class WidenCameraRole1805000000000 implements MigrationInterface {
  name = 'WidenCameraRole1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_videos" ALTER COLUMN "camera_role" TYPE character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "photos" ALTER COLUMN "camera_role" TYPE character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "photos" ALTER COLUMN "camera_role" TYPE character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_videos" ALTER COLUMN "camera_role" TYPE character varying(20)`,
    );
  }
}
