import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * `GET /v1/campaigns/:id/stats/roster-groups?groupBy=&secondaryGroupBy=`
 * (plan §3.3, feature 7). `groupBy`/`secondaryGroupBy` can be any real
 * column OR any jsonb key this campaign's own API pull discovered — a
 * fixed `@IsIn` allowlist can't be declared at the DTO level.
 * `RosterGroupStatsService.groupStats` re-validates both against this
 * campaign's real allowlist before either ever reaches SQL (see that
 * method's own doc comment) — this DTO only guards against an
 * empty/missing `groupBy`.
 */
export class RosterGroupsQueryDto {
  @ApiProperty({
    description: 'Tên field để nhóm — xem GET .../roster-group-fields',
  })
  @IsString()
  @IsNotEmpty()
  groupBy: string;

  @ApiPropertyOptional({
    description: 'Tầng nhóm thứ 2 (tối đa 2 tầng), tuỳ chọn',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secondaryGroupBy?: string;
}
