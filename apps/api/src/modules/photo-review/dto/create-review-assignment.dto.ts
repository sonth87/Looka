import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/** Body of `POST /v1/review/assignments` — plan §5.2, feature 13. */
export class CreateReviewAssignmentDto {
  @ApiProperty({ description: 'Người được gán (users.id)' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Trường nhóm',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
  })
  @IsIn(REVIEW_ASSIGNMENT_GROUP_FIELDS)
  groupField: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number];

  @ApiProperty({ description: 'Giá trị của trường nhóm, vd "Khoa CNTT"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  groupValue: string;
}
