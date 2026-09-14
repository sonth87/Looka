import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** `GET /v1/stats/identification?from&to` — system-wide; the campaign-scoped counterpart is `GET /v1/campaigns/:id/stats/identification`, no query DTO of its own (just `from`/`to`, reused here). */
export class IdentificationStatsQueryDto {
  @ApiPropertyOptional({
    description: 'Mặc định 30 ngày gần nhất nếu bỏ trống',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
