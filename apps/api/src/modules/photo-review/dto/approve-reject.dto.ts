import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRejectDto {
  @ApiPropertyOptional({ description: 'Ghi chú, đặc biệt hữu ích khi từ chối' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
