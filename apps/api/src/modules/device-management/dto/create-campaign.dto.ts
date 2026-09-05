import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import type { CaptureTriggerMode } from '@face/core';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CampaignPurpose } from '../entities/campaign.entity';

export class CreateCampaignDto {
  @ApiProperty({ description: 'Tên campaign' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả campaign' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: CampaignPurpose, default: CampaignPurpose.STUDENT_CARD })
  @IsOptional()
  @IsEnum(CampaignPurpose)
  purpose?: CampaignPurpose;

  @ApiPropertyOptional({ description: 'Hạn dùng (ISO date) — để trống là vĩnh viễn' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Nội dung xin đồng ý (consent)' })
  @IsOptional()
  @IsString()
  consentContent?: string;

  @ApiPropertyOptional({ description: 'Danh sách bước chụp tuỳ chỉnh (CaptureStep[])' })
  @IsOptional()
  @IsArray()
  captureAngles?: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @IsOptional()
  @IsEnum(['AUTO', 'MANUAL', 'OFF'])
  captureMode?: CaptureTriggerMode;

  @ApiPropertyOptional({ description: 'Thời gian giữ tư thế ở chế độ AUTO (ms)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoHoldMs?: number;

  @ApiPropertyOptional({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  simultaneousCapture?: boolean;
}
