import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PhotoVariantKind, PhotoVariantStatus } from '../photo-review.constants';
import { SubjectPhotoSet } from './subject-photo-set.entity';

/**
 * One version of a card photo (plan §2) — automatic, AI-edited, or
 * uploaded. NEVER hard-deleted by any endpoint in this module — only
 * `DISCARDED` (kept for audit, plan R-Q6). `sourcePhotoId` intentionally
 * has no FK: it points at the `photos` table owned by the `capture` module,
 * which this module must not structurally depend on (read via plain SQL
 * against the table name instead — see `PhotoReviewService`).
 */
@Entity('photo_variants')
export class PhotoVariant extends BaseEntity {
  @Column('uuid', { name: 'set_id' })
  @Index()
  @ApiProperty({ description: 'Hồ sơ chứa phiên bản này' })
  setId: string;

  @ManyToOne(() => SubjectPhotoSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'set_id' })
  set?: SubjectPhotoSet;

  @Column('int')
  @ApiProperty({ description: 'Số thứ tự phiên bản trong hồ sơ (1, 2, 3…)' })
  version: number;

  @Column('varchar', { length: 20 })
  @ApiProperty({ description: 'Nguồn tạo phiên bản', enum: PhotoVariantKind })
  kind: PhotoVariantKind;

  @Column('uuid', { name: 'derived_from_variant_id', nullable: true })
  @ApiPropertyOptional({ description: 'Phiên bản gốc dùng để tạo bản này (sửa AI)' })
  derivedFromVariantId?: string | null;

  @Column('uuid', { name: 'source_photo_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Ảnh gốc (bảng photos) dùng làm nguồn — không có FK cứng liên module',
  })
  sourcePhotoId?: string | null;

  @Column('varchar', { length: 255, name: 'fs_file_id', nullable: true })
  @ApiPropertyOptional({ description: 'file_id trên file-service' })
  fsFileId?: string | null;

  /**
   * Remote-copy health, mirroring `photos.fsStatus` (2026-09-09 fix, migration
   * `1806000000000-PhotoVariantFsStatus.ts`) — `fsFileId` alone only ever
   * means "the file-service accepted the upload", set by
   * `VariantUploadWorkerService.send()` before the file has survived
   * fs-core's own scan. This is what that service's `pollScans()` updates as
   * the real outcome becomes known, and the one field
   * `PhotoReviewService.resolveVariantViewSource`/`resolveCurrentCardViewUrl`
   * actually trust to decide whether `fsFileId` is still a live link — a
   * `'FAILED'`/`'QUARANTINED'` value means fs-core has discarded this
   * variant's remote copy and every viewer must fall back to
   * `variant_upload_outbox.content` instead.
   */
  @Column('varchar', { length: 50, name: 'fs_status', nullable: true })
  @ApiPropertyOptional({
    description: 'Trạng thái file trên file-service (SCANNING/READY/FAILED/...)',
  })
  fsStatus?: string | null;

  /** Most recent fs-core-side failure, distinct from `note` (sidecar/pipeline failures) — same separation `photos.uploadError` keeps. */
  @Column('text', { name: 'fs_upload_error', nullable: true })
  @ApiPropertyOptional({ description: 'Lỗi upload/scan gần nhất trên file-service, nếu có' })
  fsUploadError?: string | null;

  @Column('text', { name: 'virtual_path', nullable: true })
  @ApiPropertyOptional({ description: 'Đường dẫn ảo trên file-service (card/<năm>/<sessionId>/…)' })
  virtualPath?: string | null;

  @Column('int', { nullable: true })
  @ApiPropertyOptional({ description: 'Kích thước, byte' })
  bytes?: number | null;

  @Column('varchar', { length: 64, nullable: true })
  @ApiPropertyOptional({ description: 'SHA-256 nội dung' })
  sha256?: string | null;

  @Column('int', { nullable: true })
  @ApiPropertyOptional()
  width?: number | null;

  @Column('int', { nullable: true })
  @ApiPropertyOptional()
  height?: number | null;

  @Column('int', { nullable: true })
  @ApiPropertyOptional()
  dpi?: number | null;

  @Column('varchar', { length: 20, default: PhotoVariantStatus.PROCESSING })
  @ApiProperty({ description: 'Trạng thái phiên bản', enum: PhotoVariantStatus })
  status: PhotoVariantStatus;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Prompt sửa AI, nếu là CARD_AI' })
  prompt?: string | null;

  @Column('varchar', { length: 30, name: 'region_mode', nullable: true })
  @ApiPropertyOptional({ description: 'Vùng được sửa (ngoài mặt/kính/tóc/toàn ảnh)' })
  regionMode?: string | null;

  @Column('varchar', { length: 100, name: 'model_id', nullable: true })
  @ApiPropertyOptional({ description: 'Model AI đã dùng' })
  modelId?: string | null;

  @Column('varchar', { length: 50, name: 'algorithm_version', nullable: true })
  @ApiPropertyOptional({ description: 'Phiên bản thuật toán pipeline tự động/sidecar' })
  algorithmVersion?: string | null;

  @Column('varchar', { length: 50, nullable: true })
  @ApiPropertyOptional({ description: 'Seed sinh ảnh (AI)' })
  seed?: string | null;

  @Column('real', { name: 'identity_similarity', nullable: true })
  @ApiPropertyOptional({ description: 'Độ giống khuôn mặt so với ảnh gốc (0-1)' })
  identitySimilarity?: number | null;

  @Column('jsonb', { name: 'quality_report', nullable: true })
  @ApiPropertyOptional({ description: 'Kết quả kiểm tra chất lượng' })
  qualityReport?: Record<string, unknown> | null;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  @ApiPropertyOptional({ description: 'Người tạo (upload/chấp nhận AI), null nếu hệ thống tự tạo' })
  createdByUserId?: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Ghi chú (ví dụ lý do lỗi)' })
  note?: string | null;
}
