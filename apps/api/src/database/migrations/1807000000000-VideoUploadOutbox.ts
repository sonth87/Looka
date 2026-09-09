import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Local-first bytes storage for `session_videos` (2026-09-09, "route kiosk
 * VIDEO uploads through apps/api the same way kiosk PHOTO uploads already
 * work" — see `capture`'s own `upload_outbox`, `1787300000000-
 * InitCaptureSchema.ts`, which this mirrors).
 *
 * A parallel table, not a reuse of `upload_outbox`: that table's `photo_id`
 * is a NOT NULL FK straight into `photos`, so a video row would need either
 * a second nullable FK bolted on or relaxing `photo_id` to nullable and
 * teaching every existing reader (`PhotoService`, `UploadWorkerService`) to
 * handle a row with no photo — the exact same reasoning
 * `1803000000000-VariantUploadOutbox.ts` already used for `photo_variants`.
 *
 * Differences from `upload_outbox`, both deliberate:
 *  - `status` includes `'DONE'` from the start (unlike the original
 *    `upload_outbox_status_enum`, which `UploadWorkerService.pollScans()`
 *    sets to `'DONE'` despite the enum never having gained that label — a
 *    pre-existing gap in that table, out of scope to fix here). This table
 *    is new, so it is defined correctly from day one.
 *  - `approved_at` starts NOT required at insert time the same way
 *    `upload_outbox` isn't either, but `SessionVideoService.addDeviceVideo`
 *    always sets it immediately (`now()`) — a video is enqueued only once
 *    the kiosk has ALREADY locally approved its session (see
 *    `apps/desktop/src/main/uploads.ts`'s `approveSessionUpload()`), so
 *    there is no separate staged-then-approved window the way a photo has.
 *    Kept as a real gate (not always-true) so `VideoUploadWorkerService
 *    .claimNext()` can reuse the identical `WHERE ... approved_at IS NOT
 *    NULL` predicate `UploadWorkerService` already relies on, rather than a
 *    special case for "this table has no staging concept."
 */
export class VideoUploadOutbox1807000000000 implements MigrationInterface {
  name = 'VideoUploadOutbox1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "video_upload_outbox_status_enum" AS ENUM ('PENDING', 'SENDING', 'UPLOADED', 'DONE', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "video_upload_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "video_id" uuid NOT NULL,
        "idem_key" character varying(255) NOT NULL,
        "virtual_path" text NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "content" bytea NOT NULL,
        "visibility" character varying(10),
        "status" "video_upload_outbox_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "next_retry_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "approved_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_video_upload_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_video_upload_outbox_idem_key" UNIQUE ("idem_key"),
        CONSTRAINT "CHK_video_upload_outbox_visibility"
          CHECK ("visibility" IS NULL OR "visibility" IN ('public', 'private')),
        CONSTRAINT "FK_video_upload_outbox_video" FOREIGN KEY ("video_id")
          REFERENCES "session_videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_video_upload_outbox_created_at" ON "video_upload_outbox" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_upload_outbox_video_id" ON "video_upload_outbox" ("video_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_upload_outbox_status" ON "video_upload_outbox" ("status")`,
    );
    // Mirrors `upload_outbox`'s own `IDX_upload_outbox_due` (post-A.4 shape,
    // with the approval gate) — the exact predicate
    // `VideoUploadWorkerService.claimNext()` filters on.
    await queryRunner.query(`
      CREATE INDEX "IDX_video_upload_outbox_due" ON "video_upload_outbox" ("status", "next_retry_at")
        WHERE "status" IN ('PENDING', 'SENDING') AND "approved_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "video_upload_outbox"`);
    await queryRunner.query(`DROP TYPE "video_upload_outbox_status_enum"`);
  }
}
