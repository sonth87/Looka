import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CameraRole, CaptureTriggerMode } from '@face/core';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CampaignManualStatus, CardSpec } from '../entities/campaign.entity';

const CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;

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

  @ApiPropertyOptional({ description: 'Mã campaign, ví dụ 2026DOT01' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code chỉ chứa chữ, số, gạch dưới, gạch ngang',
  })
  code?: string;

  @ApiPropertyOptional({ description: 'Khóa (K20…)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cohort?: string;

  @ApiPropertyOptional({
    description: 'ISO date, hoặc null để bỏ mốc mở campaign (mở ngay)',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({
    description: 'ISO date, hoặc null để chuyển lại thành vĩnh viễn',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({
    description: 'Chỉ tiêu số lượng SV dự kiến, hoặc null để bỏ giới hạn',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  quotaPlanned?: number | null;

  @ApiPropertyOptional({
    enum: ['PAUSED', 'CLOSED'],
    nullable: true,
    description: 'null để bỏ ghi đè, quay lại trạng thái suy ra từ ngày',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['PAUSED', 'CLOSED'])
  manualStatus?: CampaignManualStatus | null;

  @ApiPropertyOptional({ enum: CAMERA_ROLES, isArray: true, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @IsIn(CAMERA_ROLES, { each: true })
  recordVideoRoles?: CameraRole[] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  cardSpec?: CardSpec | null;

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

  /** @deprecated Moved to kiosk-side settings — see `Campaign.captureMode`'s own doc comment. */
  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @IsOptional()
  captureMode?: CaptureTriggerMode;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.autoHoldMs`'s own doc comment. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  autoHoldMs?: number;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.simultaneousCapture`'s own doc comment. */
  @ApiPropertyOptional({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
  })
  @IsOptional()
  @IsBoolean()
  simultaneousCapture?: boolean;

  @ApiPropertyOptional({
    description: 'Quay video trong lúc chụp (lưu local, không upload)',
  })
  @IsOptional()
  @IsBoolean()
  recordVideo?: boolean;
}
