import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';

/**
 * Query params for `GET /v1/campaigns/stats/timeseries` — same
 * `@Type(() => Number)` + `class-validator` pattern as `ListSessionsQueryDto`'s
 * `limit` field, since query strings arrive as strings and need coercing
 * before validation.
 */
export class GetCampaignsTimeseriesQueryDto {
  @ApiPropertyOptional({
    description: 'Số ngày gần nhất cần lấy dữ liệu (mặc định 14, tối đa 90)',
    example: 14,
    default: 14,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(90)
  days?: number = 14;
}
