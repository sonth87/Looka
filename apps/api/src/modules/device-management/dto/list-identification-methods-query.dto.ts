import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
} from 'class-validator';

/**
 * Same §9.1 backward-compat rule 6 pattern as the other admin catalogs
 * (`ListCampaignsQueryDto`, `ListCaptureAnglePresetsQueryDto`) — `page` has
 * no default so its absence stays observable: a workflow-config form
 * picking methods needs every row in one shot and keeps getting the legacy
 * plain array, while `IdentificationMethodsPage.tsx`'s own management list
 * opts into `{items, meta}` by passing `page`.
 */
export class ListIdentificationMethodsQueryDto {
  @ApiPropertyOptional({
    description:
      'true = trả cả method đã active=false, mặc định chỉ trả method đang active',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({
    description: 'Trang — bỏ trống để giữ hành vi cũ (trả mảng, không lọc)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tìm theo mã hoặc tên hiển thị' })
  @IsOptional()
  @IsString()
  q?: string;
}
