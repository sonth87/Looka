import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** `GET /v1/dashboard/kpis?from&to&operatorUserId&campaignId` — cms-8-screens-api-plan.md §2.1/D-Q12. */
export class DashboardKpisQueryDto {
  @ApiPropertyOptional({ description: 'Mặc định 7 ngày gần nhất nếu bỏ trống' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Mặc định là người đang đăng nhập (D-Q12)',
  })
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
