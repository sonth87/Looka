import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * `stats_campaign_snapshot` — cms-8-screens-api-plan.md §2.9. Recomputed
 * WHOLESALE (not incremented) for a set of campaigns at once — one batched
 * query, not N+1 — by `SnapshotRefreshWorker` (every 5 minutes, every
 * `effectiveStatus = OPEN` campaign + anything closed in the last 24h) and,
 * best-effort, right after `CampaignSubjectService.importRoster` (P3) so
 * `rosterValid`/`notCaptured` don't wait up to 5 minutes to reflect a fresh
 * import.
 *
 * Cross-module raw SQL throughout (`campaigns`, `campaign_subjects`,
 * `sessions`, `subject_photo_sets`) — same "plain column any module can
 * read" convention `CampaignService.countCompletedSessions` and
 * `PhotoReviewService`'s own class doc comment already establish; this
 * module owns none of those tables.
 */
@Injectable()
export class CampaignSnapshotService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * `campaignIds: null` recomputes every `effectiveStatus = OPEN` campaign
   * plus anything with `manual_status = 'CLOSED'` or past `expires_at`
   * within the last 24h — mirrors `computeEffectiveStatus()`'s own rules
   * (device-management/utils/campaign-status.util.ts) so a campaign that
   * just closed still gets one final accurate snapshot instead of going
   * stale mid-close.
   */
  async refresh(campaignIds: string[] | null): Promise<number> {
    // `manager.query()`/`dataSource.query()` returns the RETURNING rows as
    // a flat array directly (confirmed live — see `CaptureStatsService.
    // recomputeTimingAndBreakdowns`'s own doc comment on the exact same
    // mistake, caught via a live "invalid input syntax for type integer:
    // NaN" failure) — no destructuring layer needed here.
    const written: Array<{ campaign_id: string }> = await this.dataSource.query(
      `
      WITH scope AS (
        SELECT c.id FROM campaigns c
        WHERE ($1::uuid[] IS NOT NULL AND c.id = ANY($1))
           OR (
             $1::uuid[] IS NULL
             AND (
               c.manual_status IS DISTINCT FROM 'CLOSED'
               AND (c.expires_at IS NULL OR c.expires_at >= now() - interval '24 hours')
             )
           )
      ),
      src AS (
        SELECT
          c.id AS campaign_id,
          c.quota_planned,
          COALESCE((SELECT COUNT(*) FROM campaign_subjects cs WHERE cs.campaign_id = c.id AND cs.status = 'VALID'), 0) AS roster_valid,
          COALESCE((SELECT COUNT(*) FROM sessions s WHERE s.campaign_id = c.id AND s.status = 'COMPLETED'), 0) AS sessions,
          COALESCE((SELECT COUNT(DISTINCT COALESCE(s.subject_code, s.id::text)) FROM sessions s WHERE s.campaign_id = c.id AND s.status = 'COMPLETED'), 0) AS subjects_captured,
          COALESCE((SELECT COUNT(*) FROM subject_photo_sets sps WHERE sps.campaign_id = c.id AND sps.status = 'APPROVED'), 0) AS processed,
          COALESCE((SELECT COUNT(*) FROM subject_photo_sets sps WHERE sps.campaign_id = c.id AND sps.status IN ('READY', 'IN_REVIEW')), 0) AS pending_review,
          COALESCE((SELECT COUNT(*) FROM subject_photo_sets sps WHERE sps.campaign_id = c.id AND sps.status = 'AUTO_FAILED'), 0) AS capture_errors,
          COALESCE((SELECT COUNT(*) FROM subject_photo_sets sps WHERE sps.campaign_id = c.id AND sps.due_at IS NOT NULL AND sps.due_at < now() AND sps.status NOT IN ('APPROVED', 'REJECTED')), 0) AS overdue,
          COALESCE((SELECT COUNT(*) FROM sessions s WHERE s.campaign_id = c.id AND s.status = 'IN_PROGRESS' AND COALESCE(s.captured_at, s.created_at) >= now() - interval '15 minutes'), 0) AS in_progress_now,
          (SELECT MAX(COALESCE(s.captured_at, s.created_at)) FROM sessions s WHERE s.campaign_id = c.id) AS last_capture_at
        FROM campaigns c
        JOIN scope ON scope.id = c.id
      )
      INSERT INTO stats_campaign_snapshot (
        campaign_id, quota, roster_valid, sessions, subjects_captured, processed,
        pending_review, capture_errors, not_captured, printed, overdue, in_progress_now,
        last_capture_at, computed_at
      )
      SELECT
        campaign_id,
        COALESCE(quota_planned, NULLIF(roster_valid, 0)),
        roster_valid, sessions, subjects_captured, processed, pending_review, capture_errors,
        CASE WHEN roster_valid = 0 THEN NULL ELSE GREATEST(roster_valid - subjects_captured, 0) END,
        0, overdue, in_progress_now, last_capture_at, now()
      FROM src
      ON CONFLICT (campaign_id) DO UPDATE SET
        quota = EXCLUDED.quota,
        roster_valid = EXCLUDED.roster_valid,
        sessions = EXCLUDED.sessions,
        subjects_captured = EXCLUDED.subjects_captured,
        processed = EXCLUDED.processed,
        pending_review = EXCLUDED.pending_review,
        capture_errors = EXCLUDED.capture_errors,
        not_captured = EXCLUDED.not_captured,
        overdue = EXCLUDED.overdue,
        in_progress_now = EXCLUDED.in_progress_now,
        last_capture_at = EXCLUDED.last_capture_at,
        computed_at = EXCLUDED.computed_at
      RETURNING campaign_id
      `,
      [campaignIds],
    );
    return written.length;
  }
}
