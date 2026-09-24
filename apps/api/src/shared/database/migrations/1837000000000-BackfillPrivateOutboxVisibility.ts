import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills stale `visibility = 'private'` rows in `upload_outbox` /
 * `video_upload_outbox` left over from before `1787400000000-
 * AddOutboxVisibility.ts`'s own comment: `PhotoService.addPhoto` originally
 * wrote 'private' for every card photo, reverted to 'public' 2026-09-14 once
 * testing showed file-service's owner-based ACL always denies a non-owner
 * read of a private file (Looka's client never sends `X-Owner-User-Id`).
 * That fix changed the CODE that decides visibility for new rows going
 * forward; it never touched rows already sitting in either outbox table
 * with the old value.
 *
 * That matters because both workers resend a row's OWN stored `visibility`
 * unchanged on every retry (`UploadWorkerService.send`, `VideoUploadWorker
 * Service.send`) — a not-yet-`DONE` legacy row (still `PENDING`/`SENDING`,
 * or `UPLOADED` and re-queued later by `retryPurgedUploads` after a
 * scan-pipeline purge) keeps resending `X-Visibility: private` forever.
 * Set to `NULL` rather than hardcoded to `'public'`, matching that same
 * migration's own documented column contract ("NULL means let the
 * file-service apply its own default") instead of re-baking a business
 * decision into historical data a second place.
 *
 * `DONE` rows are left alone on purpose — their `content` has already been
 * cleared (`pollScans`, once the file reached `READY`) and they are never
 * resent again, so there is nothing for a stale value to affect there.
 */
export class BackfillPrivateOutboxVisibility1837000000000 implements MigrationInterface {
  name = 'BackfillPrivateOutboxVisibility1837000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "upload_outbox" SET "visibility" = NULL WHERE "visibility" = 'private' AND "status" <> 'DONE'`,
    );
    await queryRunner.query(
      `UPDATE "video_upload_outbox" SET "visibility" = NULL WHERE "visibility" = 'private' AND "status" <> 'DONE'`,
    );
  }

  public async down(): Promise<void> {
    // Not reversible: the original migration's own comment already
    // establishes that 'private' was a mistaken value for these rows
    // (file-service can never honor it without X-Owner-User-Id, which this
    // client never sends), not data worth restoring on rollback.
  }
}
