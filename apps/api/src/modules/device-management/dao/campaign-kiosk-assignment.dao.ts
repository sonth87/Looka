import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/** `GET /v1/campaigns/:id/assignments` / `GET /v1/me/assignments` row. */
export class CampaignKioskAssignmentDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  deviceId: string;

  /** Not a `campaign_kiosk_assignments` column — merged in from `devices` by the service, same pattern `CampaignMemberDao.email` uses. */
  @ApiPropertyOptional()
  @Expose()
  deviceName?: string;

  @ApiProperty()
  @Expose()
  userId: string;

  @ApiPropertyOptional()
  @Expose()
  userEmail?: string;

  @ApiPropertyOptional()
  @Expose()
  userDisplayName?: string | null;

  @ApiPropertyOptional()
  @Expose()
  assignedByUserId?: string | null;

  @ApiProperty()
  @Expose()
  assignedAt: Date;

  @ApiPropertyOptional()
  @Expose()
  note?: string | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
