import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CardSpec } from '../entities/campaign.entity';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** `PATCH /v1/capture-configurations/:id` (item 10) — every field optional, same partial-update convention `UpdateCampaignDto` uses. */
export class UpdateCaptureConfigurationDto {
  @ApiPropertyOptional({ description: 'Tên cấu hình' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Mô tả cấu hình' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Danh sách bước chụp (mẫu)',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  captureAngles?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Chuẩn ảnh thẻ (mẫu)' })
  @IsOptional()
  @IsObject()
  cardSpec?: CardSpec;
}
