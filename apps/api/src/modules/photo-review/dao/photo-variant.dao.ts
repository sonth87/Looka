import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { PhotoVariantKind, PhotoVariantStatus } from '../photo-review.constants';

/**
 * One version of a card photo, as returned to the CMS. `viewUrl`/
 * `viewUrlExpiresAt` are resolved best-effort at the service layer (same
 * pattern as `StudentService.getStudentDetail` in the capture module) —
 * absent when the variant has no `fsFileId` yet (still `PROCESSING`) or the
 * file-service call failed.
 */
export class PhotoVariantDao {
  @ApiProperty({ description: 'Variant id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  setId: string;

  @ApiProperty()
  @Expose()
  version: number;

  @ApiProperty({ enum: PhotoVariantKind })
  @Expose()
  kind: PhotoVariantKind;

  @ApiPropertyOptional()
  @Expose()
  derivedFromVariantId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  sourcePhotoId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  fsFileId?: string | null;

  @ApiPropertyOptional({ description: 'Trạng thái file trên file-service (SCANNING/READY/FAILED/...) — xem PhotoReviewService.resolveVariantViewSource' })
  @Expose()
  fsStatus?: string | null;

  @ApiPropertyOptional()
  @Expose()
  virtualPath?: string | null;

  @ApiPropertyOptional()
  @Expose()
  bytes?: number | null;

  @ApiPropertyOptional()
  @Expose()
  width?: number | null;

  @ApiPropertyOptional()
  @Expose()
  height?: number | null;

  @ApiPropertyOptional()
  @Expose()
  dpi?: number | null;

  @ApiProperty({ enum: PhotoVariantStatus })
  @Expose()
  status: PhotoVariantStatus;

  @ApiPropertyOptional()
  @Expose()
  prompt?: string | null;

  @ApiPropertyOptional()
  @Expose()
  regionMode?: string | null;

  @ApiPropertyOptional()
  @Expose()
  modelId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  algorithmVersion?: string | null;

  @ApiPropertyOptional()
  @Expose()
  seed?: string | null;

  @ApiPropertyOptional({ description: 'Độ giống khuôn mặt so với ảnh gốc (0-1)' })
  @Expose()
  identitySimilarity?: number | null;

  @ApiPropertyOptional()
  @Expose()
  qualityReport?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @Expose()
  createdByUserId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  note?: string | null;

  @ApiPropertyOptional({ description: 'Link xem ảnh, ngắn hạn — vắng mặt nếu chưa sẵn sàng' })
  @Expose()
  viewUrl?: string;

  @ApiPropertyOptional()
  @Expose()
  viewUrlExpiresAt?: string;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
