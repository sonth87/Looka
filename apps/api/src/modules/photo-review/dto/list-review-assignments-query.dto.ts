import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Query of `GET /v1/review/assignments` — plan §5.2, feature 13. */
export class ListReviewAssignmentsQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo người được gán' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
