import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/** One row per campaign, recomputed wholesale (not incremented) every `SNAPSHOT_REFRESH` tick — §2.9. Backs the dashboard's active-campaigns list and the campaign detail's own progress numbers. */
@Entity('stats_campaign_snapshot')
export class StatsCampaignSnapshot extends BaseEntity {
  @Column('uuid', { name: 'campaign_id', unique: true })
  campaignId: string;

  /** `quotaPlanned ?? rosterValid (if > 0) ?? null` — "không giới hạn". */
  @Column('int', { nullable: true })
  quota?: number | null;

  @Column('int', { default: 0, name: 'roster_valid' })
  rosterValid: number;

  @Column('int', { default: 0 })
  sessions: number;

  @Column('int', { default: 0, name: 'subjects_captured' })
  subjectsCaptured: number;

  @Column('int', { default: 0 })
  processed: number;

  @Column('int', { default: 0, name: 'pending_review' })
  pendingReview: number;

  @Column('int', { default: 0, name: 'capture_errors' })
  captureErrors: number;

  /** `rosterValid - subjectsCaptured`, `null` when there is no roster at all (not merely zero progress). */
  @Column('int', { nullable: true, name: 'not_captured' })
  notCaptured?: number | null;

  @Column('int', { default: 0 })
  printed: number;

  @Column('int', { default: 0 })
  overdue: number;

  @Column('int', { default: 0, name: 'in_progress_now' })
  inProgressNow: number;

  @Column('timestamptz', { nullable: true, name: 'last_capture_at' })
  lastCaptureAt?: Date | null;

  @Column('timestamptz', { name: 'computed_at' })
  computedAt: Date;
}
