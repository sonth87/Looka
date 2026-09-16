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
 * Same §9.1 backward-compat rule 6 pattern as `ListCampaignsQueryDto` — `page`
 * has no default so its absence stays observable, letting the controller keep
 * returning the legacy plain array (e.g. for `CaptureAnglesTable`'s picker,
 * which needs every preset in one shot) until a caller opts into
 * `{items, meta}` by passing `page` (the CMS's own "Góc chụp" management list).
 */
export class ListCaptureAnglePresetsQueryDto {
  @ApiPropertyOptional({
    description:
      'true = trả cả preset đã active=false, mặc định chỉ trả preset đang active',
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
