import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Campaign } from './campaign.entity';

export type CampaignMemberStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

/**
 * Per-campaign approval — docs/plans/campaign-config-sso-card-photo-discussion.md
 * §2.3/§3.2.2. A person requests to join one campaign at a time
 * (`POST /v1/campaigns/:id/join`, idempotent), an admin (CTSV) approves/
 * rejects/revokes by hand on the CMS — no auto-approval by domain/role this
 * pass (Q3: "CTSV duyệt tay"). Unique on `(campaignId, userId)`: a person has
 * at most one membership row per campaign, whose `status` transitions
 * PENDING → APPROVED|REJECTED, or APPROVED → REVOKED — see
 * `CampaignMemberService.decide` for the actual state machine.
 */
@Entity('campaign_members')
@Unique('UQ_campaign_members_campaign_user', ['campaignId', 'userId'])
export class CampaignMember extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign được xin tham gia' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('uuid', { name: 'user_id' })
  @Index()
  @ApiProperty({ description: 'Người xin tham gia' })
  userId: string;

  @Column('varchar', { length: 10 })
  @ApiProperty({
    description: 'PENDING | APPROVED | REJECTED | REVOKED',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'],
  })
  status: CampaignMemberStatus;

  @Column('timestamptz', { name: 'requested_at' })
  @ApiProperty({ description: 'Thời điểm gửi yêu cầu tham gia' })
  requestedAt: Date;

  @Column('timestamptz', { nullable: true, name: 'decided_at' })
  @ApiPropertyOptional({ description: 'Thời điểm được duyệt/từ chối/thu hồi' })
  decidedAt?: Date | null;

  @Column('uuid', { nullable: true, name: 'decided_by_user_id' })
  @ApiPropertyOptional({ description: 'Người duyệt/từ chối/thu hồi' })
  decidedByUserId?: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Ghi chú của người duyệt' })
  note?: string | null;
}
