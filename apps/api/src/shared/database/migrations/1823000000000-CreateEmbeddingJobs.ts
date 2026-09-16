import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `embedding_jobs` — the backend-owned queue that replaces the desktop
 * kiosk's client-side per-photo call to the external face-embedding server
 * (2026-09-16, "tôi muốn phần embedding đó sẽ do backend xử lý, khi nhận
 * ảnh và lưu sang file server thì chạy bất đồng bộ để embedding"). Mirrors
 * `upload_outbox` (`InitCaptureSchema1787300000000`) closely — same
 * `gen_random_uuid()` id generation, same timestamptz created/updated
 * columns, same PENDING/SENDING/terminal status shape drained by a
 * `FOR UPDATE SKIP LOCKED` claim loop — but deliberately its own table
 * rather than a repurposed column on `upload_outbox`:
 *
 *  - `content` is a SEPARATE snapshot of the image bytes, taken at the same
 *    moment `upload_outbox.content` is written (`PhotoService.addPhoto`/
 *    `addDevicePhoto`), not read back from that column later — that column
 *    is cleared once ITS OWN upload reaches a terminal state (`DONE`/
 *    `READY`), which happens on its own schedule, independent of whether
 *    this row has been sent to the embedding server yet. Embedding must
 *    keep working regardless of that ordering, so it owns its own copy.
 *  - `status` is a plain `varchar(20)`, not a Postgres enum type (unlike
 *    `upload_outbox_status_enum`) — deliberately simpler for a table with no
 *    other consumer needing the enum's type-safety at the SQL level.
 *  - `photo_id` is UNIQUE, enabling `ON CONFLICT (photo_id) DO NOTHING` on a
 *    resent photo — the same idempotency shape `upload_outbox.idem_key`
 *    gives that table, just keyed on the photo itself since this table has
 *    no separate idempotency-key concept of its own.
 *
 * Left un-run against the real database on purpose, matching every other
 * migration created this session (see `1822000000000-AddRequiresEmbedding`)
 * — the user applies it separately.
 */
export class CreateEmbeddingJobs1823000000000 implements MigrationInterface {
  name = 'CreateEmbeddingJobs1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "embedding_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "photo_id" uuid NOT NULL,
        "user_code" character varying(100) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "content" bytea NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "embedding_id" integer,
        "next_retry_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_embedding_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_embedding_jobs_photo_id" UNIQUE ("photo_id"),
        CONSTRAINT "FK_embedding_jobs_photo" FOREIGN KEY ("photo_id")
          REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_embedding_jobs_created_at" ON "embedding_jobs" ("created_at")`,
    );
    // Partial index on the exact predicate `claimNext` filters by — same
    // reasoning as `IDX_upload_outbox_due` in InitCaptureSchema.
    await queryRunner.query(`
      CREATE INDEX "IDX_embedding_jobs_due" ON "embedding_jobs" ("status", "next_retry_at")
        WHERE "status" IN ('PENDING', 'SENDING')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "embedding_jobs"`);
  }
}
