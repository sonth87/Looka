import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CardSpec } from '../entities/campaign.entity';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `POST /v1/capture-configurations` (item 10) — `captureAngles`/`cardSpec`
 * accept the exact same loosely-typed jsonb shapes `CreateCampaignDto`
 * does (deep validation is `CaptureConfigurationService`'s job, reusing
 * `validateCaptureAngles` — the same rules a campaign's own steps must
 * pass, since this is what gets copied verbatim onto one).
 */
export class CreateCaptureConfigurationDto {
  @ApiProperty({ description: 'Tên cấu hình, ví dụ "3 camera - Thẻ SV 4x6"' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả cấu hình' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Danh sách bước chụp (mẫu) — cùng định dạng CaptureStep[] của campaign',
    type: [Object],
  })
  @IsArray()
  captureAngles: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Chuẩn ảnh thẻ (mẫu)' })
  @IsOptional()
  @IsObject()
  cardSpec?: CardSpec;
}
