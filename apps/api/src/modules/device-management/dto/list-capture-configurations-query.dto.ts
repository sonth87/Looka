import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, Max } from 'class-validator';

/**
 * Same §9.1 backward-compat rule 6 pattern as `ListCampaignsQueryDto` — `page`
 * has no default so its absence stays observable: `CampaignForm.tsx`'s
 * "Chọn cấu hình mẫu chụp" picker needs every configuration in one call and
 * keeps getting the legacy plain array, while `CaptureConfigurationsPage.tsx`
 * (the CMS management list) opts into `{items, meta}` by passing `page`.
 */
export class ListCaptureConfigurationsQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên mẫu' })
  @IsOptional()
  @IsString()
  q?: string;
}
