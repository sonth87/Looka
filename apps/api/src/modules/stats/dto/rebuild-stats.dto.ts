import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** `POST /v1/stats/rebuild` body. */
export class RebuildStatsDto {
  @ApiProperty()
  @IsDateString()
  from: string;

  @ApiProperty()
  @IsDateString()
  to: string;

  @ApiPropertyOptional({ description: 'Bỏ trống để tính lại mọi campaign' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
