import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PhotoReviewSetStatus } from '../photo-review.constants';

export class ExportQueryDto {
  @ApiProperty({ description: 'Campaign cần xuất gói ảnh' })
  @IsUUID()
  campaignId: string;

  @ApiPropertyOptional({
    enum: PhotoReviewSetStatus,
    default: PhotoReviewSetStatus.APPROVED,
    description: 'Chỉ xuất hồ sơ ở trạng thái này (mặc định APPROVED, đúng mục đích in thẻ)',
  })
  @IsOptional()
  @IsEnum(PhotoReviewSetStatus)
  status?: PhotoReviewSetStatus;
}
