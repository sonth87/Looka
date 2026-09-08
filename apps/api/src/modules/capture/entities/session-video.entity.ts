import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Session } from './session.entity';

/**
 * One video recorded alongside a capture session (kiosk only — the web path
 * has no video story), reported via the VIDEO_STATUS device event once the
 * operator approves the session — see `CaptureReportService.applyVideoStatus`
 * and `apps/desktop/src/main/uploads.ts`'s `enqueueSessionVideos`.
 *
 * No `stepId`/`attempt` the way `Photo` has: a video is never retaken, and a
 * session has at most one per camera role, so its own `id` (the kiosk's
 * `deterministicUuid`, shared with its `upload_outbox` row) is enough for
 * `ON CONFLICT (id)` without a compound unique constraint.
 */
@Entity('session_videos')
export class SessionVideo extends BaseEntity {
  @Column('uuid', { name: 'session_id' })
  @Index()
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session?: Session;

  /** e.g. CENTER/LEFT/RIGHT, or the physical camera id when no role mapping applies. */
  @Column('varchar', { length: 20, nullable: true, name: 'camera_role' })
  @ApiPropertyOptional({ description: 'Camera đã quay video này' })
  cameraRole?: string;

  @Column('varchar', { length: 100, name: 'mime_type' })
  @ApiProperty({ description: 'Kiểu MIME của video' })
  mimeType: string;

  @Column('int')
  @ApiProperty({ description: 'Kích thước video, tính bằng byte' })
  bytes: number;

  @Column('varchar', { length: 64 })
  @ApiProperty({ description: 'SHA-256 của nội dung video' })
  sha256: string;

  @Column('int', { nullable: true, name: 'duration_ms' })
  @ApiPropertyOptional({ description: 'Thời lượng video, tính bằng mili giây' })
  durationMs?: number;

  @Column('uuid', { nullable: true, name: 'fs_file_id' })
  @ApiPropertyOptional({
    description: 'file_id trên file-service, có sau khi upload xong',
  })
  fsFileId?: string;

  @Column('varchar', { length: 255, nullable: true, name: 'fs_etag' })
  @ApiPropertyOptional({ description: 'ETag hiện hành trên file-service' })
  fsEtag?: string;

  @Column('varchar', { length: 50, nullable: true, name: 'fs_status' })
  @ApiPropertyOptional({
    description: 'Trạng thái file trên file-service (SCANNING/READY/...)',
  })
  fsStatus?: string;

  @Column('text', { nullable: true, name: 'virtual_path' })
  @ApiPropertyOptional({ description: 'Đường dẫn ảo trên file-service' })
  virtualPath?: string;

  @Column('timestamptz', { nullable: true, name: 'captured_at' })
  @ApiPropertyOptional({ description: 'Thời điểm quay, theo đồng hồ kiosk' })
  capturedAt?: Date;

  @Column('timestamptz', { nullable: true, name: 'uploaded_at' })
  @ApiPropertyOptional({ description: 'Thời điểm tải lên file-service xong' })
  uploadedAt?: Date;

  @Column('timestamptz', { nullable: true, name: 'ready_at' })
  @ApiPropertyOptional({ description: 'Thời điểm file-service báo READY' })
  readyAt?: Date;

  /** High-water mark — see `Photo.fsStatusAt`'s identical doc comment for why. */
  @Column('timestamptz', { nullable: true, name: 'fs_status_at' })
  @ApiPropertyOptional({ description: 'Thời điểm của trạng thái fs mới nhất' })
  fsStatusAt?: Date;

  @Column('varchar', { length: 20, nullable: true, name: 'local_status' })
  @ApiPropertyOptional({ description: 'Trạng thái hàng đợi cục bộ trên kiosk' })
  localStatus?: string;

  @Column('text', { nullable: true, name: 'upload_error' })
  @ApiPropertyOptional({ description: 'Lỗi upload gần nhất, nếu có' })
  uploadError?: string;
}
