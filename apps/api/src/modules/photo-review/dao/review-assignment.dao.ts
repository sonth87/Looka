import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

export class ReviewAssignmentDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  userId: string;

  @ApiPropertyOptional({
    description: 'Tên/email người được gán, nếu tra được',
  })
  @Expose()
  userName?: string;

  @ApiProperty({ enum: REVIEW_ASSIGNMENT_GROUP_FIELDS })
  @Expose()
  groupField: string;

  @ApiProperty()
  @Expose()
  groupValue: string;

  @ApiPropertyOptional()
  @Expose()
  createdByUserId?: string;

  @ApiProperty()
  @Expose()
  createdAt: Date;
}
