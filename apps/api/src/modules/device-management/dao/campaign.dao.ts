import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CameraRole, CaptureStep, CaptureTriggerMode } from '@face/core';
import { Expose } from 'class-transformer';
import {
  CampaignPurpose,
  type CampaignManualStatus,
  type CardSpec,
} from '../entities/campaign.entity';
import type { EffectiveCampaignStatus } from '../utils/campaign-status.util';

export class CampaignDao {
  @ApiProperty({ description: 'Campaign id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  description?: string;

  @ApiProperty({ enum: CampaignPurpose })
  @Expose()
  purpose: CampaignPurpose;

  @ApiPropertyOptional({ description: 'Mã campaign, ví dụ 2026DOT01' })
  @Expose()
  code?: string | null;

  @ApiPropertyOptional({ description: 'Khóa (K20…)' })
  @Expose()
  cohort?: string | null;

  @ApiPropertyOptional({
    description: 'Thời điểm mở campaign — null = mở ngay',
  })
  @Expose()
  startsAt?: Date | null;

  @ApiPropertyOptional({ description: 'null = vĩnh viễn' })
  @Expose()
  expiresAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Chỉ tiêu số lượng SV dự kiến — null = không giới hạn',
  })
  @Expose()
  quotaPlanned?: number | null;

  @ApiPropertyOptional({ enum: ['PAUSED', 'CLOSED'] })
  @Expose()
  manualStatus?: CampaignManualStatus | null;

  @ApiPropertyOptional({ type: [String] })
  @Expose()
  recordVideoRoles?: CameraRole[] | null;

  @ApiPropertyOptional()
  @Expose()
  cardSpec?: CardSpec | null;

  @ApiProperty({
    description:
      'Trạng thái hiệu lực, suy ra từ manualStatus/startsAt/expiresAt — không lưu (§3.1.2)',
    enum: ['PAUSED', 'CLOSED', 'UPCOMING', 'OPEN', 'EXPIRED'],
  })
  @Expose()
  effectiveStatus: EffectiveCampaignStatus;

  @ApiProperty({
    description:
      'true nếu số phiên đã duyệt (COMPLETED) ≥ quotaPlanned — chỉ để cảnh báo, không chặn chụp (Q6)',
  })
  @Expose()
  quotaReached: boolean;

  @ApiProperty({
    description:
      'Số camera vật lý phân biệt mà captureAngles ưu tiên dùng — gợi ý không chặn, xem capture-angles.validator.ts',
  })
  @Expose()
  requiredCameraCount: number;

  @ApiPropertyOptional()
  @Expose()
  consentContent?: string | null;

  @ApiProperty()
  @Expose()
  consentVersion: number;

  @ApiPropertyOptional()
  @Expose()
  captureAngles?: CaptureStep[] | null;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.captureMode`'s own doc comment. Kept only for the old `GET /v1/devices/config` kiosk path. */
  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @Expose()
  captureMode?: CaptureTriggerMode | null;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.autoHoldMs`'s own doc comment. Kept only for the old `GET /v1/devices/config` kiosk path. */
  @ApiPropertyOptional()
  @Expose()
  autoHoldMs?: number | null;

  /** @deprecated Moved to kiosk-side settings — see `Campaign.simultaneousCapture`'s own doc comment. Kept only for the old `GET /v1/devices/config` kiosk path; use `requiredCameraCount` instead. */
  @ApiProperty({
    description: 'Chụp đồng thời — mỗi khung cần 1 camera vật lý riêng',
  })
  @Expose()
  simultaneousCapture: boolean;

  @ApiProperty({
    description: 'Quay video trong lúc chụp (lưu local, không upload)',
  })
  @Expose()
  recordVideo: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
