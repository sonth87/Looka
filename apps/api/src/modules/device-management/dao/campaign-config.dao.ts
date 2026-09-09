import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CameraRole, CaptureStep } from '@face/core';
import { Expose } from 'class-transformer';
import {
  CampaignManualStatus,
  CampaignPurpose,
  CardSpec,
} from '../entities/campaign.entity';
import type { EffectiveCampaignStatus } from '../utils/campaign-status.util';

/**
 * `GET /v1/campaigns/:id/config` response (§3.1.4/§3.2.2) — deliberately a
 * standalone class, NOT `class CampaignConfigDao extends CampaignDao`:
 * `toDao`'s `plainToInstance(..., { excludeExtraneousValues: true })` keeps
 * only fields `@Expose()`d somewhere on the *target* class's prototype
 * chain, and a subclass redeclaring a parent's already-`@Expose()`d
 * property without the decorator does not reliably un-expose it in
 * class-transformer. The one deliberate difference from `CampaignDao`: no
 * `captureMode`/`autoHoldMs`/`simultaneousCapture` — those three are
 * `GET /v1/devices/config`-only per the 2026-09-08 decision (see those
 * fields' own `@deprecated` doc comments on the `Campaign` entity).
 */
export class CampaignConfigDao {
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

  @ApiPropertyOptional()
  @Expose()
  code?: string | null;

  @ApiPropertyOptional()
  @Expose()
  cohort?: string | null;

  @ApiPropertyOptional()
  @Expose()
  startsAt?: Date | null;

  @ApiPropertyOptional({ description: 'null = vĩnh viễn' })
  @Expose()
  expiresAt?: Date | null;

  @ApiPropertyOptional()
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

  @ApiProperty({ enum: ['PAUSED', 'CLOSED', 'UPCOMING', 'OPEN', 'EXPIRED'] })
  @Expose()
  effectiveStatus: EffectiveCampaignStatus;

  @ApiProperty()
  @Expose()
  quotaReached: boolean;

  @ApiProperty()
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
