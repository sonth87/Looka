import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Query of `GET /v1/review/assignments` — plan §5.2, feature 13. */
export class ListReviewAssignmentsQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo người được gán' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** 2026-09-28 PER-CAMPAIGN pivot — CMS table's own campaign filter. */
  @ApiPropertyOptional({ description: 'Lọc theo đợt chụp' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
