import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { REVIEW_ASSIGNMENT_GROUP_FIELDS } from '../photo-review.constants';

/**
 * Body of `POST /v1/review/assignments` — plan §5.2, feature 13, PER-CAMPAIGN
 * pivot 2026-09-28. `groupField`/`groupValue` are now BOTH optional: omit
 * both for "cả đợt chụp" (whole-campaign access), or supply both together
 * for a Lớp/Khoa/Ngành-scoped grant within `campaignId` — one without the
 * other is rejected (see `ReviewAssignmentService.create`'s own
 * both-or-neither check; not expressed as a class-validator decorator here,
 * matching this module's existing preference for a plain in-service check
 * over a custom validator for a two-field relationship).
 */
export class CreateReviewAssignmentDto {
  @ApiProperty({ description: 'Người được gán (users.id)' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Đợt chụp được gán (campaigns.id)' })
  @IsUUID()
  campaignId: string;

  @ApiPropertyOptional({
    description: 'Trường nhóm — bỏ trống (cùng groupValue) nghĩa là cả đợt',
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
  })
  @IsOptional()
  @IsIn(REVIEW_ASSIGNMENT_GROUP_FIELDS)
  groupField?: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number];

  @ApiPropertyOptional({
    description: 'Giá trị của trường nhóm, vd "Khoa CNTT"',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  groupValue?: string;
}
