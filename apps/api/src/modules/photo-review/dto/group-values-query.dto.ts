import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/**
 * Query of `GET /v1/review/assignments/group-values` — plan §5.2, feature
 * 13. `campaignId` added 2026-09-28 (PER-CAMPAIGN pivot) so the CMS
 * assignment picker's group-value dropdown only offers values that actually
 * occur within the campaign being assigned, not the whole app's roster;
 * optional for backward compatibility, but the CMS always sends it now that
 * every assignment requires picking a campaign first.
 */
export class GroupValuesQueryDto {
  @ApiProperty({
    description: 'Trường cần lấy danh sách giá trị duy nhất',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
  })
  @IsIn(REVIEW_ASSIGNMENT_GROUP_FIELDS)
  field: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number];

  @ApiPropertyOptional({ description: 'Giới hạn trong một đợt chụp' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
