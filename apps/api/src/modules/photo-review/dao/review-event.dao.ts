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

  @ApiPropertyOptional({ description: 'Email người thực hiện, nếu tra được' })
  @Expose()
  actorEmail?: string | null;

  @ApiPropertyOptional()
  @Expose()
  payload?: Record<string, unknown> | null;

  @ApiProperty()
  @Expose()
  at: Date;
}
