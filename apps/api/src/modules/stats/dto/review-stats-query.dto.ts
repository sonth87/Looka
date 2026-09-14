import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** `GET /v1/review/stats?campaignId&from&to&reviewerUserId`. */
export class ReviewStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;
}
