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

  @ApiPropertyOptional() @Expose() userEmail?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Phòng ban' })
  @Expose()
  userDepartment?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Khoa' })
  @Expose()
  userFaculty?: string | null;
  @ApiPropertyOptional({
    type: [String],
    description: 'Mã vai trò RBAC (roles.code) của người này',
  })
  @Expose()
  userRoleCodes?: string[];

  @ApiProperty({ description: 'Đợt chụp được gán (campaigns.id)' })
  @Expose()
  campaignId: string;

  @ApiPropertyOptional({ description: 'Tên đợt chụp, nếu tra được' })
  @Expose()
  campaignName?: string;

  @ApiPropertyOptional({
    enum: REVIEW_ASSIGNMENT_GROUP_FIELDS,
    description: 'Trường nhóm — bỏ trống nghĩa là cả đợt chụp',
    nullable: true,
  })
  @Expose()
  groupField?: string;

  @ApiPropertyOptional({
    description: 'Giá trị của trường nhóm — bỏ trống nếu cả đợt',
    nullable: true,
  })
  @Expose()
  groupValue?: string;

  @ApiPropertyOptional()
  @Expose()
  createdByUserId?: string;

  @ApiProperty()
  @Expose()
  createdAt: Date;
}

/**
 * `GET /v1/review/my-campaigns` (2026-09-28 PER-CAMPAIGN pivot) — the
 * campaigns the calling reviewer can act on at all: for an admin, every
 * campaign; for anyone else, the distinct campaigns they hold at least one
 * `review_assignments` row for (whole-campaign or group). Feeds the CMS
 * review-list page's own campaign dropdown so a scoped reviewer is never
 * offered a campaign they cannot see anything in.
 */
export class MyReviewCampaignDao {
  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  campaignName: string;
}
