import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { CampaignMemberStatus } from '../entities/campaign-member.entity';

export class CampaignMemberDao {
  @ApiProperty({ description: 'Membership id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  userId: string;

  /**
   * The requesting user's own identity — not a `campaign_members` column,
   * merged in from `users` by `CampaignMemberService` after the query (see
   * that service's own comment). Added 2026-09-08: the CMS "Cán bộ chụp"
   * tab needs a name/email to show a CTSV who is actually asking to join,
   * not a bare uuid.
   */
  @ApiProperty()
  @Expose()
  email: string;

  @ApiPropertyOptional()
  @Expose()
  displayName?: string | null;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] })
  @Expose()
  status: CampaignMemberStatus;

  @ApiProperty()
  @Expose()
  requestedAt: Date;

  @ApiPropertyOptional()
  @Expose()
  decidedAt?: Date | null;

  @ApiPropertyOptional()
  @Expose()
  decidedByUserId?: string | null;

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

/** `membership.status` on `GET /v1/me/campaigns` — `NONE` when no `campaign_members` row exists for the caller (never a stored value, only a display default). */
export type MembershipStatusDao = 'NONE' | CampaignMemberStatus;

export class MembershipDao {
  @ApiProperty({ enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] })
  @Expose()
  status: MembershipStatusDao;
}
