import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives `photo_variants` the same remote-copy-health tracking `photos`
 * already has (`fs_status`/`upload_error` — see
 * `1787900000000-CaptureRecords.ts`) — 2026-09-09 fix, paired with the same
 * day's `VariantUploadWorkerService.send()`/`pollScans()` fix and
 * `PhotoService.resolveViewSource`'s own earlier fix for the raw-photo
 * pipeline.
 *
 * Before this, a variant's `fs_file_id` being set meant only "the
 * file-service ACCEPTED the upload", never "the file actually survived its
 * own virus-scan" — this real fs-core deployment has been observed purging a
 * file during that scan and later answering `getFile` with 404 (confirmed
 * live against a specific variant, 2026-09-09: `fs_file_id =
 * 'be9e9fb0-c9a9-4ace-8875-1918f777d7df'` now 404s). With no column to
 * record that outcome, nothing could ever tell a variant whose remote copy
 * was purged apart from one that is still perfectly healthy on fs-core —
 * `PhotoReviewService`'s view-link resolution kept trusting `fsFileId` alone
 * forever, and `VariantUploadWorkerService.send()` (before its own pairing
 * fix) had already cleared the one local fallback that could have saved it.
 *
 * `fs_upload_error` is a distinct column from the existing `note` (used for
 * sidecar/pipeline failures, e.g. `AUTO_FAILED`) — a variant can fail on
 * fs-core's side for reasons that have nothing to do with why the sidecar
 * produced it, same separation `photos.upload_error` already keeps from
 * whatever else might describe that row.
 */
export class PhotoVariantFsStatus1806000000000 implements MigrationInterface {
  name = 'PhotoVariantFsStatus1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "photo_variants"
        ADD COLUMN "fs_status" character varying(50),
        ADD COLUMN "fs_upload_error" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "photo_variants"
        DROP COLUMN "fs_upload_error",
        DROP COLUMN "fs_status"
    `);
  }
}
