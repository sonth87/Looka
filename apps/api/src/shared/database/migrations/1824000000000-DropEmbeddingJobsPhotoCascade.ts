import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `embedding_jobs`'s `ON DELETE CASCADE` FK to `photos` (added by
 * `CreateEmbeddingJobs1823000000000`).
 *
 * Live-confirmed the same day (2026-09-16, verifying a real kiosk capture):
 * the kiosk's own SESSION_REPORT/upload-status reconciliation
 * (`CaptureReportService.applySessionReport`/`applyPhotoStatus`) ends up
 * deleting and re-inserting a session's `photos` rows well after capture —
 * even for the photo that survives as the final kept attempt, which gets a
 * fresh row (same id, new `created_at`) some seconds later. Every one of
 * this session's `embedding_jobs` rows — including ones that had already
 * reached a terminal `DONE`/`FAILED` state, with a real answer from the
 * external server already recorded — vanished the moment the FK's CASCADE
 * fired on the row it replaced.
 *
 * `embedding_jobs.content` was already designed to be an independent
 * snapshot for exactly this reason (see that migration's own doc comment:
 * "Embedding must keep working regardless of that ordering, so it owns its
 * own copy") — the FK contradicted that intent for `photo_id` itself. This
 * table needs `photo_id` only to build a filename and to join back to
 * `sessions` for `campaign_id`/`device_id` when recording a
 * `device_events` row (`EmbeddingWorkerService.recordDeviceEvent`) — neither
 * needs a live FK, and a dangling `photo_id` after this change is harmless:
 * `recordDeviceEvent`'s join simply returns no row, which it already treats
 * as "log and skip" rather than throwing.
 */
export class DropEmbeddingJobsPhotoCascade1824000000000
  implements MigrationInterface
{
  name = 'DropEmbeddingJobsPhotoCascade1824000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "embedding_jobs" DROP CONSTRAINT "FK_embedding_jobs_photo"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "embedding_jobs"
        ADD CONSTRAINT "FK_embedding_jobs_photo" FOREIGN KEY ("photo_id")
          REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }
}
