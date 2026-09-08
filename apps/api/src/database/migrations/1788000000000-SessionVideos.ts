import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Video-upload-to-file-service (2026-09-08 product request — see
 * docs/ROADMAP.md). Local video recording has existed since migration
 * 1787800000000-AddRecordVideo; this is the first time any of it is reported
 * centrally. Mirrors the photos' upload-lifecycle columns (see
 * 1787900000000-CaptureRecords.ts) in a table of its own rather than adding
 * columns to `photos`, because a video has no `step_id`/`attempt` — one
 * recording per camera per session, never retaken — so the
 * `(session_id, step_id, attempt)` unique constraint `photos` relies on
 * would not mean anything here; `id` (the kiosk-generated
 * `deterministicUuid`, the same one `upload_outbox.id` uses) is enough on
 * its own for `ON CONFLICT (id)`.
 */
export class SessionVideos1788000000000 implements MigrationInterface {
  name = 'SessionVideos1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "session_videos" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "session_id" uuid NOT NULL,
        "camera_role" character varying(20),
        "mime_type" character varying(100) NOT NULL,
        "bytes" integer NOT NULL,
        "sha256" character varying(64) NOT NULL,
        "duration_ms" integer,
        "fs_file_id" uuid,
        "fs_etag" character varying(255),
        "fs_status" character varying(50),
        "virtual_path" text,
        "captured_at" TIMESTAMP WITH TIME ZONE,
        "uploaded_at" TIMESTAMP WITH TIME ZONE,
        "ready_at" TIMESTAMP WITH TIME ZONE,
        "fs_status_at" TIMESTAMP WITH TIME ZONE,
        "local_status" character varying(20),
        "upload_error" text,
        CONSTRAINT "PK_session_videos" PRIMARY KEY ("id")
      )
    `);
    // CASCADE (unlike sessions -> devices/campaigns in the previous
    // migration): a video only ever makes sense attached to its session, so
    // deleting the session should take its video rows with it, the same as
    // photos already does.
    await queryRunner.query(`
      ALTER TABLE "session_videos"
        ADD CONSTRAINT "FK_session_videos_session" FOREIGN KEY ("session_id")
          REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_session_videos_session_id" ON "session_videos" ("session_id")`,
    );

    // Appended, not used in this same migration/transaction — see
    // 1787900000000-CaptureRecords.ts's identical note on why.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" ADD VALUE IF NOT EXISTS 'VIDEO_STATUS'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Same "rebuild rather than narrow" approach as CaptureRecords' down(),
    // and the same intentional failure if any row already used the value —
    // see that migration's down() for the full reasoning.
    await queryRunner.query(
      `ALTER TYPE "device_events_type_enum" RENAME TO "device_events_type_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "device_events_type_enum" AS ENUM (
        'SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE',
        'CB_HELP_INTERVENTION', 'SESSION_REPORT', 'PHOTO_STATUS'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "device_events"
        ALTER COLUMN "type" TYPE "device_events_type_enum"
        USING "type"::text::"device_events_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "device_events_type_enum_old"`);

    await queryRunner.query(`DROP INDEX "IDX_session_videos_session_id"`);
    await queryRunner.query(
      `ALTER TABLE "session_videos" DROP CONSTRAINT "FK_session_videos_session"`,
    );
    await queryRunner.query(`DROP TABLE "session_videos"`);
  }
}
