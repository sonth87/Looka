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
 * Same §9.1 backward-compat rule 6 pattern used across the other admin
 * catalogs (`ListCampaignsQueryDto`, `ListCaptureAnglePresetsQueryDto`) —
 * `page` has no default so its absence stays observable: callers that just
 * need every kind in one shot (e.g. `CaptureConfigurationsPage.tsx`'s card-
 * spec picker) keep getting the legacy plain array, while
 * `PhotoKindsPage.tsx`'s own management list opts into `{items, meta}` by
 * passing `page`.
 */
export class ListPhotoKindsQueryDto {
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

  @ApiPropertyOptional({
    description: 'Lọc theo đang dùng/đã ẩn — bỏ trống = cả hai',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;
}
