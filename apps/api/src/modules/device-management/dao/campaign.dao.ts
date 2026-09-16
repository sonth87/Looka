import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CameraRole, CaptureStep, CaptureTriggerMode } from '@face/core';
import { Expose, Type } from 'class-transformer';
import {
  CampaignPurpose,
  type CampaignManualStatus,
  type CardSpec,
} from '../entities/campaign.entity';
import type { EffectiveCampaignStatus } from '../utils/campaign-status.util';

/**
 * The resolved workflow a campaign is pinned to — cms-8-screens-api-plan.md
 * §2.2/P2. Never populated by `toDao()`'s plain field copy (no matching
 * entity column) — `CampaignService.toCampaignResponse()` sets `dao.workflow`
 * manually, same pattern already used for `effectiveStatus`/`quotaReached`/
 * `requiredCameraCount`.
 */
export class CampaignWorkflowRefDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  code: string;

  @ApiProperty()
  @Expose()
  versionId: string;

  @ApiProperty()
  @Expose()
  version: number;
}

/**
 * `CampaignDao.progress` — cms-8-screens-api-plan.md §2.3's "danh sách có
 * phân trang, lọc, tiến độ". Only populated by the paginated list path
 * (`CampaignService.listCampaignsPaginated`); `null` on every other read
 * path (single-get, unpaginated list) since it costs 2 extra grouped
 * queries per page and nothing outside the list screen asked for it.
 */
export class CampaignProgressDao {
  @ApiProperty({
    description: 'Số SV đã chụp (phiên COMPLETED, tính theo subjectCode)',
  })
  @Expose()
  captured: number;

  @ApiProperty({ description: 'Số bộ ảnh đã duyệt (APPROVED)' })
  @Expose()
  approved: number;

  @ApiPropertyOptional({
    description: 'quotaPlanned, hoặc số dòng roster VALID nếu không đặt quota',
  })
  @Expose()
  quota?: number | null;

  @ApiPropertyOptional({
    description: 'captured/quota*100, null nếu không có quota',
  })
  @Expose()
  percent?: number | null;
}

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

  @ApiProperty({
    description:
      'Có gửi ảnh chụp lên máy chủ nhận diện khuôn mặt (embedding) hay không',
  })
  @Expose()
  requiresEmbedding: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;

  @ApiPropertyOptional({
    description:
      'Nghiệp vụ đã ghim, nếu có — captureAngles/cardSpec ở trên đã gộp giá trị từ đây khi cột riêng của campaign để trống',
    type: CampaignWorkflowRefDao,
  })
  @Expose()
  @Type(() => CampaignWorkflowRefDao)
  workflow?: CampaignWorkflowRefDao | null;

  @ApiPropertyOptional({ description: 'Thời gian cam kết xử lý ảnh (giờ)' })
  @Expose()
  processingSlaHours?: number | null;

  @ApiPropertyOptional({ description: 'Địa điểm đợt chụp' })
  @Expose()
  location?: string | null;

  /** Not a `campaigns` column — `code`/`name` of `workflow`, if pinned, so a CMS list doesn't need a second lookup per row. */
  @ApiPropertyOptional()
  @Expose()
  workflowName?: string | null;

  @ApiPropertyOptional({ type: CampaignProgressDao })
  @Expose()
  @Type(() => CampaignProgressDao)
  progress?: CampaignProgressDao | null;
}
