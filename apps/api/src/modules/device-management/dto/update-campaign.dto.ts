import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CaptureTriggerMode } from '@face/core';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Covers both extending/renewing a campaign (set or clear `expiresAt`) and
 * editing its consent text — see docs/plans/multi-camera-device-management-discussion.md
 * §3.2/§2.4. `expiresAt: null` explicitly clears the expiry (back to
 * "vĩnh viễn"); omitting the field leaves it untouched, which is why this
 * cannot just be a partial-fields-optional version of the create DTO.
 */
export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'ISO date, hoặc null để chuyển lại thành vĩnh viễn',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  expiresAt?: string | null;

  /**
   * Ghi nội dung mới — service tự tăng `consentVersion` mỗi lần field này
   * thực sự đổi giá trị, không phải mỗi lần request tới (mục 2.4).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  consentContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  captureAngles?: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @IsOptional()
  captureMode?: CaptureTriggerMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  autoHoldMs?: number;

  @ApiPropertyOptional({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
  })
  @IsOptional()
  @IsBoolean()
  simultaneousCapture?: boolean;
}
