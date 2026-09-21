import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/** Query of `GET /v1/review/assignments/group-values` — plan §5.2, feature 13. */
export class GroupValuesQueryDto {
  @ApiProperty({
    description: 'Trường cần lấy danh sách giá trị duy nhất',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
  })
  @IsIn(REVIEW_ASSIGNMENT_GROUP_FIELDS)
  field: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number];
}
