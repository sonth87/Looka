import { BaseEntity } from '@app/modules/shared/common/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Session } from './session.entity';

@Entity('photos')
// A retake is a new attempt, never an overwrite of an earlier one - the
// earlier photo must survive until the operator has actually chosen between
// them. This is what makes that guarantee a database constraint rather than
// an application convention that a bug could quietly violate.
@Index('IDX_photos_session_step_attempt', ['sessionId', 'stepId', 'attempt'], {
  unique: true,
})
export class Photo extends BaseEntity {
  @Column('uuid', { name: 'session_id' })
  sessionId: string;

  @ManyToOne(() => Session, (session) => session.photos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session?: Session;

  @Column('varchar', { length: 50, name: 'step_id' })
  @ApiProperty({ description: 'Bước trong quy trình chụp, ví dụ FRONT/LEFT' })
  stepId: string;

  @Column('int', { default: 1 })
  @ApiProperty({
    description: 'Số lần thử của bước này (chụp lại = attempt mới)',
  })
  attempt: number;

  @Column('varchar', { length: 100, name: 'mime_type' })
  @ApiProperty({ description: 'Kiểu MIME của ảnh' })
  mimeType: string;

  @Column('int')
  @ApiProperty({ description: 'Kích thước ảnh, tính bằng byte' })
  bytes: number;

  @Column('varchar', { length: 64 })
  @ApiProperty({ description: 'SHA-256 của nội dung ảnh' })
  sha256: string;

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

  /** e.g. FRONT/LEFT/RIGHT - the kiosk's capture-step type, not the web path's free-form stepId. */
  @Column('varchar', { length: 20, nullable: true, name: 'step_type' })
  @ApiPropertyOptional({ description: 'Loại bước chụp (kiosk), vd FRONT' })
  stepType?: string;

  /** e.g. CENTER/LEFT/RIGHT - which physical camera took this frame (kiosk only). */
  @Column('varchar', { length: 10, nullable: true, name: 'camera_role' })
  @ApiPropertyOptional({ description: 'Camera vật lý đã chụp (kiosk)' })
  cameraRole?: string;

  /** The kiosk's own clock at capture time (kiosk only; the web path has no separate capture instant worth keeping). */
  @Column('timestamptz', { nullable: true, name: 'captured_at' })
  @ApiPropertyOptional({ description: 'Thời điểm chụp, theo đồng hồ kiosk' })
  capturedAt?: Date;

  @Column('timestamptz', { nullable: true, name: 'uploaded_at' })
  @ApiPropertyOptional({ description: 'Thời điểm tải lên file-service xong' })
  uploadedAt?: Date;

  @Column('timestamptz', { nullable: true, name: 'ready_at' })
  @ApiPropertyOptional({ description: 'Thời điểm file-service báo READY' })
  readyAt?: Date;

  /**
   * High-water mark for `fsFileId`/`fsStatus`/`localStatus`/`uploadError`:
   * a PHOTO_STATUS event only applies when its own `at` is not older than
   * this - see `CaptureReportService.applyPhotoStatus`.
   */
  @Column('timestamptz', { nullable: true, name: 'fs_status_at' })
  @ApiPropertyOptional({ description: 'Thời điểm của trạng thái fs mới nhất' })
  fsStatusAt?: Date;

  /** Kiosk-local queue status (PENDING/SENDING/UPLOADED/DONE/FAILED_PERMANENT) - distinct from this API's own OutboxStatus. */
  @Column('varchar', { length: 20, nullable: true, name: 'local_status' })
  @ApiPropertyOptional({ description: 'Trạng thái hàng đợi cục bộ trên kiosk' })
  localStatus?: string;

  @Column('text', { nullable: true, name: 'upload_error' })
  @ApiPropertyOptional({ description: 'Lỗi upload gần nhất, nếu có' })
  uploadError?: string;
}
