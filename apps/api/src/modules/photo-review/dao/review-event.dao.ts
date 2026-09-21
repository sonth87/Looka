import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { PhotoReviewAction } from '../photo-review.constants';

export class ReviewEventDao {
  @ApiProperty({ description: 'Event id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  setId: string;

  @ApiPropertyOptional()
  @Expose()
  variantId?: string | null;

  @ApiProperty({ enum: PhotoReviewAction })
  @Expose()
  action: PhotoReviewAction;

  @ApiPropertyOptional()
  @Expose()
  actorUserId?: string | null;

  @ApiPropertyOptional({
    description:
      'Tên hiển thị (hoặc email nếu chưa có tên) người thực hiện, nếu tra được',
  })
  @Expose()
  actorName?: string | null;

  @ApiPropertyOptional()
  @Expose()
  payload?: Record<string, unknown> | null;

  @ApiProperty()
  @Expose()
  at: Date;
}
