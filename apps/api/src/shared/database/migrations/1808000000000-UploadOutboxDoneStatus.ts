import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes a live-confirmed gap in `upload_outbox_status_enum` (2026-09-10):
 * `UploadWorkerService.pollScans()` (`upload-worker.service.ts` ~line 212-217)
 * has, since the 2026-09-09 "never clear content before a confirmed READY"
 * fix, run `UPDATE upload_outbox SET status = 'DONE', content = ''::bytea
 * WHERE photo_id = $1` the moment a photo's scan genuinely reaches `READY` —
 * but the enum this table's `status` column actually uses
 * (`1787300000000-InitCaptureSchema.ts`) was only ever defined as
 * `('PENDING', 'SENDING', 'UPLOADED', 'FAILED')`. Every real attempt at that
 * UPDATE throws `invalid input value for enum upload_outbox_status_enum:
 * "DONE"`.
 *
 * Confirmed live against the dev DB this same session: `1807000000000-
 * VideoUploadOutbox.ts`'s own doc comment already flagged this exact gap as
 * "out of scope to fix here" when it defined `video_upload_outbox_status_enum`
 * correctly from day one (that enum already includes `'DONE'`, so
 * `VideoUploadWorkerService.pollScans()` — the video counterpart — has never
 * hit this). `pollScans()`'s catch block (line 218 on) only special-cases
 * `FsError`; a plain Postgres error from this UPDATE is not an `FsError`, so
 * it falls through to `logger.warn(...)` and is swallowed — the tick
 * continues rather than aborting, and the *previous* statement in the same
 * method (`UPDATE photos SET fs_status = $2 ...`, a separate autocommit
 * query, not in a transaction with this one) has already committed
 * `fs_status = 'READY'`. Net effect: the photo row no longer matches
 * `pollScans()`'s own `WHERE fs_status IN ('UPLOADING', 'SCANNING',
 * 'SCAN_PENDING')` filter on any future tick, so this UPDATE is never
 * retried — that `upload_outbox` row is orphaned forever at `status =
 * 'UPLOADED'` with `content` never cleared, even though the photo is
 * genuinely safe on fs-core.
 *
 * `variant_upload_outbox_status_enum` (`1803000000000-
 * VariantUploadOutbox.ts`) has the identical gap (no `'DONE'` label), but
 * `VariantUploadWorkerService.pollScans()` was checked and does NOT attempt
 * to set `status = 'DONE'` on READY — it only clears `content`, leaving
 * `status` at `'UPLOADED'` (see that method, `variant-upload-worker.service
 * .ts` ~line 236-241). So the variant table's missing label is not
 * currently exercised by any code path and is left alone here rather than
 * changed speculatively.
 *
 * `ADD VALUE IF NOT EXISTS` outside any nested transaction the same way
 * `1790000000000-DeviceSecretRotation.ts` already does for
 * `devices_status_enum` (see that migration's own note) — this project's
 * migration runner does not set an explicit `migrationsTransactionMode`,
 * and that precedent already ran clean against this same Postgres (18.4)
 * instance, so it is followed as-is rather than re-litigated here. Nothing
 * in this migration tries to USE the new label in the same transaction it
 * is added in (Postgres forbids that regardless of transaction mode), so
 * there is no ordering hazard even if migrations do run inside one shared
 * transaction.
 */
export class UploadOutboxDoneStatus1808000000000 implements MigrationInterface {
  name = 'UploadOutboxDoneStatus1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "upload_outbox_status_enum" ADD VALUE IF NOT EXISTS 'DONE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Same "rebuild rather than narrow" approach as `AttemptSuperseded`'s/
    // `DeviceSecretRotation`'s own `down()` — and the same intentional
    // failure if any row already uses the value (rolling back past data
    // that depends on the wider type must not silently drop or remap it).
    // `status` has `DEFAULT 'PENDING'` (`1787300000000-InitCaptureSchema
    // .ts`), which Postgres refuses to cast automatically across a type
    // swap, so the default is dropped before the column's type changes and
    // restored after — identical sequencing to `DeviceSecretRotation`'s own
    // `down()`.
    await queryRunner.query(
      `ALTER TABLE "upload_outbox" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "upload_outbox_status_enum" RENAME TO "upload_outbox_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "upload_outbox_status_enum" AS ENUM ('PENDING', 'SENDING', 'UPLOADED', 'FAILED')`,
    );
    await queryRunner.query(`
      ALTER TABLE "upload_outbox"
        ALTER COLUMN "status" TYPE "upload_outbox_status_enum"
        USING "status"::text::"upload_outbox_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "upload_outbox" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "upload_outbox_status_enum_old"`);
  }
}
