import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/** One `(date, campaign, reviewer)` bucket — §2.9. `reviewerUserId` is `STATS_UNKNOWN_UUID` for anything with no human actor (e.g. `AUTO_FAILED`, or `setsCreated`). `reviewSumHours` divided by `(approved+rejected)` gives `avgReviewHours` on `GET /v1/review/stats`. */
@Entity('stats_daily_review')
@Unique('UQ_stats_daily_review_key', ['date', 'campaignId', 'reviewerUserId'])
export class StatsDailyReview extends BaseEntity {
  @Column('date') date: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  campaignId: string;

  @Column('uuid', { name: 'reviewer_user_id' })
  reviewerUserId: string;

  @Column('int', { default: 0, name: 'sets_created' })
  setsCreated: number;

  @Column('int', { default: 0 })
  approved: number;

  @Column('int', { default: 0 })
  rejected: number;

  @Column('int', { default: 0, name: 'ai_requested' })
  aiRequested: number;

  @Column('int', { default: 0, name: 'ai_accepted' })
  aiAccepted: number;

  @Column('int', { default: 0 })
  uploaded: number;

  @Column('int', { default: 0, name: 'auto_failed' })
  autoFailed: number;

  @Column('real', { default: 0, name: 'review_sum_hours' })
  reviewSumHours: number;

  @Column('timestamptz', { name: 'computed_at' })
  computedAt: Date;
}
