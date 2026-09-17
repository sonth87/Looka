import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type DistinctSubjectValuesField = 'className' | 'faculty' | 'major';

/**
 * `GET /v1/campaigns/:id/subjects/distinct-values?field=`
 * (card-photo-export-and-filters-plan-2026-09-17.md §G.2.a). `field` is
 * restricted to this exact allowlist — same 3 values `ListPrintItemsQueryDto`/
 * `PhotoReview`'s `className`/`faculty`/`major` filters already use — both to
 * match the CMS contract and so the service never has to interpolate a
 * caller-supplied column name (see `CampaignSubjectService.distinctValues`'s
 * own doc comment).
 */
export class DistinctSubjectValuesQueryDto {
  @ApiProperty({ enum: ['className', 'faculty', 'major'] })
  @IsIn(['className', 'faculty', 'major'])
  field: DistinctSubjectValuesField;
}
