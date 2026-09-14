import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { STATS_UNKNOWN_UUID } from '../stats.constants';
import { vnDateString } from '../util/vn-date.util';

type ReviewCountColumn =
  | 'sets_created'
  | 'approved'
  | 'rejected'
  | 'ai_requested'
  | 'ai_accepted'
  | 'uploaded'
  | 'auto_failed';

/**
 * `stats_daily_review` — cms-8-screens-api-plan.md §2.9. Called from inside
 * `PhotoReviewService`'s own transactions, alongside its existing
 * `writeEvent(manager, ...)` calls (same `manager`) — see that class's doc
 * comments on each hook site for exactly which action maps to which column.
 * `ensureSetForApprovedSession`'s `recordSetCreated` is the one exception:
 * that method is not itself transactional (see its own doc comment in
 * `PhotoReviewService`) — called best-effort, outside a transaction, same
 * as `ensureSetForApprovedSession`'s own callers already treat it.
 */
@Injectable()
export class ReviewStatsService {
  private async increment(
    manager: EntityManager,
    date: string,
    campaignId: string,
    reviewerUserId: string,
    column: ReviewCountColumn,
    by: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO stats_daily_review (date, campaign_id, reviewer_user_id, ${column}, computed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (date, campaign_id, reviewer_user_id)
       DO UPDATE SET ${column} = stats_daily_review.${column} + EXCLUDED.${column}, computed_at = now()`,
      [date, campaignId, reviewerUserId, by],
    );
  }

  async recordSetCreated(
    manager: EntityManager,
    campaignId: string,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      STATS_UNKNOWN_UUID,
      'sets_created',
      1,
    );
  }

  async recordAiRequested(
    manager: EntityManager,
    campaignId: string,
    actorUserId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      actorUserId || STATS_UNKNOWN_UUID,
      'ai_requested',
      1,
    );
  }

  async recordAiAccepted(
    manager: EntityManager,
    campaignId: string,
    actorUserId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      actorUserId || STATS_UNKNOWN_UUID,
      'ai_accepted',
      1,
    );
  }

  async recordUploaded(
    manager: EntityManager,
    campaignId: string,
    actorUserId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      actorUserId || STATS_UNKNOWN_UUID,
      'uploaded',
      1,
    );
  }

  async recordAutoFailed(
    manager: EntityManager,
    campaignId: string,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      STATS_UNKNOWN_UUID,
      'auto_failed',
      1,
    );
  }

  /** Approve/reject — also accumulates `reviewSumHours` (`decidedAt - setCreatedAt`), the numerator of `avgReviewHours` on `GET /v1/review/stats`. */
  async recordDecision(
    manager: EntityManager,
    campaignId: string,
    actorUserId: string | null,
    action: 'APPROVED' | 'REJECTED',
    setCreatedAt: Date,
    decidedAt: Date,
  ): Promise<void> {
    const column: ReviewCountColumn =
      action === 'APPROVED' ? 'approved' : 'rejected';
    const date = vnDateString(decidedAt);
    const reviewerUserId = actorUserId || STATS_UNKNOWN_UUID;
    const hours = Math.max(
      0,
      (decidedAt.getTime() - setCreatedAt.getTime()) / 3_600_000,
    );

    await manager.query(
      `INSERT INTO stats_daily_review (date, campaign_id, reviewer_user_id, ${column}, review_sum_hours, computed_at)
       VALUES ($1, $2, $3, 1, $4, now())
       ON CONFLICT (date, campaign_id, reviewer_user_id)
       DO UPDATE SET
         ${column} = stats_daily_review.${column} + 1,
         review_sum_hours = stats_daily_review.review_sum_hours + EXCLUDED.review_sum_hours,
         computed_at = now()`,
      [date, campaignId, reviewerUserId, hours],
    );
  }
}
