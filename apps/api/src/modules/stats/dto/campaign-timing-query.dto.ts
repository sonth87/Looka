import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

/** `GET /v1/campaigns/:id/stats/timing?groupBy=device|operator|day&from&to`. */
export class CampaignTimingQueryDto {
  @ApiPropertyOptional({
    enum: ['device', 'operator', 'day'],
    default: 'device',
  })
  @IsOptional()
  @IsIn(['device', 'operator', 'day'])
  groupBy?: 'device' | 'operator' | 'day';

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
