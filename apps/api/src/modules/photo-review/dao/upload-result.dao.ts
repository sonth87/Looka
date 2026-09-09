import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { PhotoVariantDao } from './photo-variant.dao';

/**
 * Response of `POST /v1/review/sets/:id/upload` — carries the identity
 * "warn but allow" signal (plan §5.4/R-Q8: 0.70-0.85) as a response field
 * rather than a rejection. Below 0.70 the endpoint rejects with 422 instead
 * of returning this shape at all.
 */
export class UploadVariantResultDao {
  @ApiProperty({ type: PhotoVariantDao })
  @Expose()
  @Type(() => PhotoVariantDao)
  variant: PhotoVariantDao;

  @ApiPropertyOptional({ description: 'Độ giống khuôn mặt so với ảnh gốc (0-1)' })
  @Expose()
  identitySimilarity?: number;

  @ApiProperty({ description: 'true nếu độ giống trong khoảng cảnh báo (0.70-0.85) — vẫn cho phép, chỉ cảnh báo' })
  @Expose()
  identityWarning: boolean;
}
