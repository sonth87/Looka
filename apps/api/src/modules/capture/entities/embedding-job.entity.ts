import { BaseEntity } from '@app/shared/database/base.entity';
import { Column, Entity, Index } from 'typeorm';

/** `embedding_jobs.status` values — a plain varchar column, not a Postgres enum (see the migration's own doc comment for why). */
export enum EmbeddingJobStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * One photo's queued call to the external face-embedding server, owned by
 * the backend (2026-09-16) — see migration `CreateEmbeddingJobs1823000000000`
 * for the full design rationale and `EmbeddingWorkerService` for the worker
 * that drains this table. Registered in `CaptureModule`'s `TypeOrmModule
 * .forFeature([...])` the same way `UploadOutboxEntry` is, even though the
 * worker itself talks to this table almost entirely via raw SQL (mirroring
 * `UploadWorkerService`'s own convention) — the entity exists mainly so this
 * table is visible to TypeORM's schema tooling the same way every other
 * capture-module table already is.
 */
@Entity('embedding_jobs')
export class EmbeddingJob extends BaseEntity {
  /**
   * No FK/`@ManyToOne` to `Photo` here (2026-09-16 fix, dropped by migration
   * `DropEmbeddingJobsPhotoCascade1824000000000`) — the original `ON DELETE
   * CASCADE` version silently destroyed this row (and its already-recorded
   * `embedding_id`/`status`/`last_error`) whenever the kiosk's own SESSION_REPORT/
   * upload-status reconciliation later deletes-and-reinserts a `photos` row
   * for the SAME logical photo (confirmed live: the surviving photo per step
   * gets a fresh `photos.id`-preserving re-INSERT well after capture, which
   * still fires the CASCADE on the row it replaces). `content` was already
   * snapshotted independently of `photos`/`upload_outbox` for exactly this
   * kind of lifecycle-independence — the FK undermined that intent for
   * `photo_id` itself, so it is now a plain, unconstrained reference.
   */
  @Column('uuid', { name: 'photo_id' })
  photoId: string;

  /** The subject's `user_code` from the external roster — see `StudentSubjectInfo.userCode`'s own doc comment in `packages/ui/src/lib/CaptureSink.ts`. */
  @Column('varchar', { length: 100, name: 'user_code' })
  userCode: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  mimeType: string;

  /** Image bytes, snapshotted at enqueue time — a copy independent of `upload_outbox.content`, see the migration's own doc comment for why. */
  @Column('bytea')
  content: Buffer;

  @Column({ type: 'varchar', length: 20, default: EmbeddingJobStatus.PENDING })
  @Index()
  status: EmbeddingJobStatus;

  @Column('int', { default: 0 })
  attempts: number;

  @Column('text', { nullable: true, name: 'last_error' })
  lastError?: string;

  /** The external server's own returned id, once `status = 'DONE'`. */
  @Column('int', { nullable: true, name: 'embedding_id' })
  embeddingId?: number | null;

  @Column('timestamptz', { default: () => 'now()', name: 'next_retry_at' })
  nextRetryAt: Date;
}
