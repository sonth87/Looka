import { BaseEntity } from '@app/modules/shared/common/base.entity';
import type { Visibility } from '@face/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { SessionVideo } from './session-video.entity';

export enum VideoOutboxStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  UPLOADED = 'UPLOADED',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * Local-first bytes storage for `session_videos` (2026-09-09, "route kiosk
 * VIDEO uploads through apps/api" work) — the video counterpart of
 * `UploadOutboxEntry`. See `1807000000000-VideoUploadOutbox.ts` for why this
 * is a table of its own rather than a reuse of `upload_outbox`.
 *
 * Bytes land here in the same transaction as the `SessionVideo` row (see
 * `SessionVideoService.addDeviceVideo`); `VideoUploadWorkerService` drains it
 * to fs-core afterwards, exactly mirroring `UploadWorkerService` for photos.
 */
@Entity('video_upload_outbox')
export class VideoUploadOutboxEntry extends BaseEntity {
  @Column('uuid', { name: 'video_id' })
  videoId: string;

  @ManyToOne(() => SessionVideo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'video_id' })
  video?: SessionVideo;

  // Same across every retry of one video's upload, so a reply lost on the
  // way back cannot become a second file on the file-service. Reuses the
  // kiosk-generated video id itself (see `SessionVideoService.addDeviceVideo`'s
  // doc comment) — a video has no retake-at-the-same-id concept the way a
  // photo attempt does, so there is nothing else worth deriving this from.
  @Column('varchar', { length: 255, unique: true, name: 'idem_key' })
  idemKey: string;

  @Column('text', { name: 'virtual_path' })
  virtualPath: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  mimeType: string;

  @Column('bytea')
  content: Buffer;

  @Column('varchar', { length: 10, nullable: true })
  visibility?: Visibility;

  @Column({ type: 'enum', enum: VideoOutboxStatus, default: VideoOutboxStatus.PENDING })
  @Index()
  status: VideoOutboxStatus;

  @Column('int', { default: 0 })
  attempts: number;

  @Column('text', { nullable: true, name: 'last_error' })
  lastError?: string;

  @Column('timestamptz', { default: () => 'now()', name: 'next_retry_at' })
  nextRetryAt: Date;

  /** Always set at insert time — see this table's own migration doc comment for why. */
  @Column('timestamptz', { nullable: true, name: 'approved_at' })
  approvedAt?: Date;
}
