import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaptureStep, CaptureTriggerMode } from '@face/core';
import { Expose } from 'class-transformer';
import { CampaignPurpose } from '../entities/campaign.entity';

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

  @ApiPropertyOptional({ description: 'null = vĩnh viễn' })
  @Expose()
  expiresAt?: Date | null;

  @ApiPropertyOptional()
  @Expose()
  consentContent?: string | null;

  @ApiProperty()
  @Expose()
  consentVersion: number;

  @ApiPropertyOptional()
  @Expose()
  captureAngles?: CaptureStep[] | null;

  @ApiPropertyOptional({ enum: ['AUTO', 'MANUAL', 'OFF'] })
  @Expose()
  captureMode?: CaptureTriggerMode | null;

  @ApiPropertyOptional()
  @Expose()
  autoHoldMs?: number | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
