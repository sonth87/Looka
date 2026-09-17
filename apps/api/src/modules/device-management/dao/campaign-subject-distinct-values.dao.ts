import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /v1/campaigns/:id/subjects/distinct-values?field=className|faculty|major`
 * response — card-photo-export-and-filters-plan-2026-09-17.md §G.2.a.
 * Shared contract consumed by both the Photo Review and Print (batch +
 * campaign) CMS filter dropdowns — keep this shape stable.
 */
export class CampaignSubjectDistinctValuesDao {
  @ApiProperty({
    type: [String],
    description:
      'Giá trị duy nhất, đã loại null/rỗng, sắp xếp tăng dần theo văn bản',
  })
  items: string[];
}
