import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Campaign } from './campaign.entity';
import { Device } from './device.entity';

/**
 * "1 người ↔ 1 kiosk" per campaign — cms-8-screens-api-plan.md §2.3/D-Q4
 * (reverses the 2026-09-08 "không cần phân công" removal). Unique on both
 * `(campaignId, deviceId)` and `(campaignId, userId)` enforces the 1–1
 * pairing at the DB level, not just in application code. `userId` is a bare
 * uuid with no FK, same cross-module convention `campaign_members.user_id`
 * already uses (users live in `modules/shared`, not this module).
 *
 * Assigning auto-approves the person's `campaign_members` row (D-Q4) — done
 * via a direct upsert against the `CampaignMember` repository in
 * `CampaignKioskAssignmentService`, not by injecting `CampaignMemberService`
 * itself, to avoid a circular service dependency (`CampaignMemberService`
 * needs to read assignments back for `GET /v1/me/campaigns`'s
 * `assignedDevices[]`).
 */
@Entity('campaign_kiosk_assignments')
@Unique('UQ_campaign_kiosk_assignments_campaign_device', [
  'campaignId',
  'deviceId',
])
@Unique('UQ_campaign_kiosk_assignments_campaign_user', ['campaignId', 'userId'])
export class CampaignKioskAssignment extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign đợt chụp' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('uuid', { name: 'device_id' })
  @Index()
  @ApiProperty({ description: 'Kiosk được gán' })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device?: Device;

  @Column('uuid', { name: 'user_id' })
  @Index()
  @ApiProperty({ description: 'Người được gán vào kiosk này' })
  userId: string;

  @Column('uuid', { nullable: true, name: 'assigned_by_user_id' })
  @ApiPropertyOptional({ description: 'Người thực hiện gán' })
  assignedByUserId?: string | null;

  @Column('timestamptz', { name: 'assigned_at' })
  @ApiProperty({ description: 'Thời điểm gán' })
  assignedAt: Date;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Ghi chú' })
  note?: string | null;
}
