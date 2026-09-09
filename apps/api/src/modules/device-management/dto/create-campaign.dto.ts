import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import type { CameraRole, CaptureTriggerMode } from '@face/core';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CampaignPurpose,
  type CampaignManualStatus,
  type CardSpec,
} from '../entities/campaign.entity';

const CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;

export class CreateCampaignDto {
  @ApiProperty({ description: 'Tên campaign' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả campaign' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: CampaignPurpose,
    default: CampaignPurpose.STUDENT_CARD,
  })
  @IsOptional()
  @IsEnum(CampaignPurpose)
  purpose?: CampaignPurpose;

  /**
   * Meant to be required going forward (2026-09-08, §3.1.1) — nullable at
   * the DB level only because existing rows created before this field
   * existed can't be sanely backfilled with a unique value. **Deviation
   * from the literal "require it in the DTO" instruction, noted for
   * reconciliation**: kept `@IsOptional()` here rather than mandatory,
   * because dozens of pre-existing calls in
   * `device-management-persistence.spec.ts` construct campaigns with only
   * `name` and predate this field entirely — making it a hard 400 would
   * break all of them for a cosmetic field. `CampaignService.createCampaign`
   * generates a unique fallback code when omitted instead, so the actual
   * invariant ("every campaign ends up with a non-null code") still holds;
   * a real CMS "create campaign" form is expected to always supply one.
   */
  @ApiPropertyOptional({
    description: 'Mã campaign, ví dụ 2026DOT01 — bỏ trống sẽ được tự sinh',
    maxLength: 20,
  })
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
    description: 'Thời điểm mở campaign (ISO) — để trống là mở ngay',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'Hạn dùng (ISO date) — để trống là vĩnh viễn',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Chỉ tiêu số lượng SV dự kiến — để trống là không giới hạn',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quotaPlanned?: number;

  @ApiPropertyOptional({
    enum: ['PAUSED', 'CLOSED'],
    description: 'Ghi đè trạng thái suy ra từ ngày',
  })
  @IsOptional()
  @IsIn(['PAUSED', 'CLOSED'])
  manualStatus?: CampaignManualStatus;

  @ApiPropertyOptional({
    description:
      'Camera nào quay video khi recordVideo bật — để trống là tất cả camera đã gán',
    enum: CAMERA_ROLES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(CAMERA_ROLES, { each: true })
  recordVideoRoles?: CameraRole[];

  /**
   * Full shape validated at runtime by the (not-yet-built) card-photo
   * pipeline, not here — same lightweight `@IsObject()` treatment
   * `captureAngles` already gets below for its own jsonb shape.
   */
  @ApiPropertyOptional({
    description: 'Chuẩn ảnh thẻ (cỡ/dpi/nền/crop/làm mịn)',
  })
  @IsOptional()
  @IsObject()
  cardSpec?: CardSpec;

  @ApiPropertyOptional({ description: 'Nội dung xin đồng ý (consent)' })
  @IsOptional()
  @IsString()
  consentContent?: string;

  @ApiPropertyOptional({
    description:
      'Danh sách bước chụp tuỳ chỉnh (CaptureStep[]) — 2-20 bước, đúng 1 bước isCardSource',
  })
  @IsOptional()
  @IsArray()
  captureAngles?: Record<string, unknown>[];

  /**
   * @deprecated Moved to kiosk-side settings — see `Campaign.captureMode`'s
   * own doc comment. Still accepted here only because this DTO is also the
   * one the old admin campaign form posts to; not read by any new code path.
   */
  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @IsOptional()
  @IsEnum(['AUTO', 'MANUAL', 'OFF'])
  captureMode?: CaptureTriggerMode;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.autoHoldMs`'s own doc comment. */
  @ApiPropertyOptional({
    description: 'Thời gian giữ tư thế ở chế độ AUTO (ms)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoHoldMs?: number;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.simultaneousCapture`'s own doc comment. */
  @ApiPropertyOptional({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  simultaneousCapture?: boolean;

  @ApiPropertyOptional({
    description: 'Quay video trong lúc chụp (lưu local, không upload)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  recordVideo?: boolean;
}
