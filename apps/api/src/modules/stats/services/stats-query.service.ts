import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { STATS_UNKNOWN_UUID } from '../stats.constants';

interface DashboardKpisResult {
  captured: { total: number; byDay: Array<{ date: string; count: number }> };
  pendingReview: number;
  printed: number;
  overdue: number;
}

interface ActiveCampaignResult {
  campaignId: string;
  name: string;
  code: string | null;
  location: string | null;
  quota: number | null;
  captured: number;
  processed: number;
  sessions: number;
  pendingReview: number;
  captureErrors: number;
  notCaptured: number | null;
  overdue: number;
  inProgressNow: number;
  lastCaptureAt: Date | null;
}

interface TimingRow {
  key: string | null;
  count: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

interface ReviewStatsResult {
  byStatus: Record<string, number>;
  approved: number;
  rejected: number;
  aiEdited: number;
  uploaded: number;
  autoOnly: number;
  byReviewer: Array<{
    reviewerUserId: string | null;
    reviewerName: string;
    approved: number;
    rejected: number;
  }>;
  avgReviewHours: number | null;
}

/**
 * Read side for `dashboard/*`, `review/stats`, `campaigns/:id/stats/timing`,
 * and `stats/identification` — cms-8-screens-api-plan.md §2.9's own design
 * principle: "Dashboard và mọi endpoint stats đọc từ các bảng này, không
 * tính trực tiếp trên sessions/photos." Every method here reads `stats_*`
 * only, never `sessions`/`photos`/`subject_photo_sets` directly — the one
 * documented exception is `reviewStats`'s `byStatus`, a genuinely live count
 * (matches §2.9's own "Lưu ý": "danh sách chi tiết vẫn truy vấn bảng nguồn
 * bằng index... bảng stats_* chỉ giữ số đếm").
 */
@Injectable()
export class StatsQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async dashboardKpis(query: {
    from: string;
    to: string;
    operatorUserId: string;
    campaignId?: string;
  }): Promise<DashboardKpisResult> {
    const capturedRows: Array<{ date: string; count: number }> =
      await this.dataSource.query(
        `SELECT date::text, SUM(subjects_captured)::int AS count
         FROM stats_daily_captures
        WHERE date BETWEEN $1 AND $2
          AND operator_user_id = $3
          AND ($4::uuid IS NULL OR campaign_id = $4)
        GROUP BY date ORDER BY date`,
        [query.from, query.to, query.operatorUserId, query.campaignId ?? null],
      );
    const total = capturedRows.reduce((sum, r) => sum + r.count, 0);

    const [snapshotRow]: Array<{
      pending_review: number;
      printed: number;
      overdue: number;
    }> = await this.dataSource.query(
      `SELECT COALESCE(SUM(pending_review),0)::int AS pending_review,
                COALESCE(SUM(printed),0)::int AS printed,
                COALESCE(SUM(overdue),0)::int AS overdue
           FROM stats_campaign_snapshot
          WHERE $1::uuid IS NULL OR campaign_id = $1`,
      [query.campaignId ?? null],
    );

    return {
      captured: { total, byDay: capturedRows },
      pendingReview: snapshotRow?.pending_review ?? 0,
      printed: snapshotRow?.printed ?? 0,
      overdue: snapshotRow?.overdue ?? 0,
    };
  }

  /** `GET /v1/dashboard/campaigns/active` — every `effectiveStatus = OPEN` campaign's latest snapshot. */
  async dashboardActiveCampaigns(): Promise<ActiveCampaignResult[]> {
    const rows: Array<{
      campaign_id: string;
      name: string;
      code: string | null;
      location: string | null;
      quota: number | null;
      subjects_captured: number;
      processed: number;
      sessions: number;
      pending_review: number;
      capture_errors: number;
      not_captured: number | null;
      overdue: number;
      in_progress_now: number;
      last_capture_at: Date | null;
    }> = await this.dataSource.query(`
      SELECT
        c.id AS campaign_id, c.name, c.code, c.location,
        s.quota, s.subjects_captured, s.processed, s.sessions, s.pending_review,
        s.capture_errors, s.not_captured, s.overdue, s.in_progress_now, s.last_capture_at
      FROM campaigns c
      JOIN stats_campaign_snapshot s ON s.campaign_id = c.id
      WHERE c.manual_status IS DISTINCT FROM 'PAUSED'
        AND c.manual_status IS DISTINCT FROM 'CLOSED'
        AND (c.starts_at IS NULL OR c.starts_at <= now())
        AND (c.expires_at IS NULL OR c.expires_at > now())
      ORDER BY c.created_at DESC
    `);

    return rows.map((r) => ({
      campaignId: r.campaign_id,
      name: r.name,
      code: r.code,
      location: r.location,
      quota: r.quota,
      captured: r.subjects_captured,
      processed: r.processed,
      sessions: r.sessions,
      pendingReview: r.pending_review,
      captureErrors: r.capture_errors,
      notCaptured: r.not_captured,
      overdue: r.overdue,
      inProgressNow: r.in_progress_now,
      lastCaptureAt: r.last_capture_at,
    }));
  }

  /** `GET /v1/campaigns/:id/stats/timing?groupBy=device|operator|day` — reads the cron-computed `timing_*` columns; empty/null until `DailyRecomputeWorker` has run at least once for the requested range. */
  async campaignTiming(
    campaignId: string,
    groupBy: 'device' | 'operator' | 'day',
    from: string,
    to: string,
  ): Promise<TimingRow[]> {
    const groupColumn =
      groupBy === 'device'
        ? 'device_id'
        : groupBy === 'operator'
          ? 'operator_user_id'
          : 'date';
    const rows: Array<{
      key: string;
      count: number;
      sum_ms: string;
      p50: number | null;
      p95: number | null;
    }> = await this.dataSource.query(
      `SELECT ${groupColumn}::text AS key,
              COALESCE(SUM(timing_count),0)::int AS count,
              COALESCE(SUM(timing_sum_ms),0) AS sum_ms,
              -- A weighted-average approximation across buckets (true p50/p95
              -- would need raw durations, which this table does not keep);
              -- each row already carries its own bucket's real percentile,
              -- so this only approximates once MULTIPLE buckets are merged
              -- (e.g. groupBy=day summing several devices for that day).
              (SUM(timing_p50_ms * timing_count) FILTER (WHERE timing_count > 0) / NULLIF(SUM(timing_count) FILTER (WHERE timing_count > 0), 0))::int AS p50,
              (SUM(timing_p95_ms * timing_count) FILTER (WHERE timing_count > 0) / NULLIF(SUM(timing_count) FILTER (WHERE timing_count > 0), 0))::int AS p95
         FROM stats_daily_captures
        WHERE campaign_id = $1 AND date BETWEEN $2 AND $3
        GROUP BY ${groupColumn}
        ORDER BY ${groupColumn}`,
      [campaignId, from, to],
    );

    return rows.map((r) => ({
      key: r.key === STATS_UNKNOWN_UUID ? null : r.key,
      count: r.count,
      avgMs: r.count > 0 ? Math.round(Number(r.sum_ms) / r.count) : null,
      p50Ms: r.p50,
      p95Ms: r.p95,
    }));
  }

  async reviewStats(query: {
    campaignId?: string;
    from: string;
    to: string;
    reviewerUserId?: string;
  }): Promise<ReviewStatsResult> {
    const [agg]: Array<{
      approved: number;
      rejected: number;
      ai_accepted: number;
      uploaded: number;
      sum_hours: number;
    }> = await this.dataSource.query(
      `SELECT COALESCE(SUM(approved),0)::int AS approved,
              COALESCE(SUM(rejected),0)::int AS rejected,
              COALESCE(SUM(ai_accepted),0)::int AS ai_accepted,
              COALESCE(SUM(uploaded),0)::int AS uploaded,
              COALESCE(SUM(review_sum_hours),0) AS sum_hours
         FROM stats_daily_review
        WHERE date BETWEEN $1 AND $2
          AND ($3::uuid IS NULL OR campaign_id = $3)
          AND ($4::uuid IS NULL OR reviewer_user_id = $4)`,
      [
        query.from,
        query.to,
        query.campaignId ?? null,
        query.reviewerUserId ?? null,
      ],
    );

    const byReviewerRows: Array<{
      reviewer_user_id: string;
      reviewer_name: string | null;
      approved: number;
      rejected: number;
    }> = await this.dataSource.query(
      `SELECT r.reviewer_user_id, COALESCE(u.display_name, u.email) AS reviewer_name,
              SUM(r.approved)::int AS approved, SUM(r.rejected)::int AS rejected
         FROM stats_daily_review r
         LEFT JOIN users u ON u.id = r.reviewer_user_id
        WHERE r.date BETWEEN $1 AND $2
          AND ($3::uuid IS NULL OR r.campaign_id = $3)
        GROUP BY r.reviewer_user_id, u.display_name, u.email
        ORDER BY reviewer_name NULLS LAST`,
      [query.from, query.to, query.campaignId ?? null],
    );

    // Live, per §2.9's own "Lưu ý" — a fresh count, not a stats_* column.
    const byStatusRows: Array<{ status: string; count: number }> =
      await this.dataSource.query(
        `SELECT status, COUNT(*)::int AS count FROM subject_photo_sets
        WHERE $1::uuid IS NULL OR campaign_id = $1
        GROUP BY status`,
        [query.campaignId ?? null],
      );

    const approved = agg?.approved ?? 0;
    const rejected = agg?.rejected ?? 0;
    const aiEdited = agg?.ai_accepted ?? 0;
    const uploaded = agg?.uploaded ?? 0;
    const reviewedCount = approved + rejected;

    return {
      byStatus: Object.fromEntries(
        byStatusRows.map((r) => [r.status, r.count]),
      ),
      approved,
      rejected,
      aiEdited,
      uploaded,
      // Approximation, documented: sets approved without an AI-accept or
      // upload-replace in their history — this codebase has no dedicated
      // counter distinguishing "approved as-is from the AUTO card" from
      // "approved after an AI/upload replacement", so this is derived
      // rather than a true independent count.
      autoOnly: Math.max(approved - aiEdited - uploaded, 0),
      byReviewer: byReviewerRows.map((r) => ({
        reviewerUserId:
          r.reviewer_user_id === STATS_UNKNOWN_UUID ? null : r.reviewer_user_id,
        reviewerName: r.reviewer_name ?? 'Không rõ (hệ thống)',
        approved: r.approved,
        rejected: r.rejected,
      })),
      avgReviewHours:
        reviewedCount > 0
          ? Number((agg.sum_hours / reviewedCount).toFixed(2))
          : null,
    };
  }

  /** `GET /v1/campaigns/:id/stats/identification` / `GET /v1/stats/identification` — `campaignId: null` sums across every campaign. */
  async identificationStats(
    campaignId: string | null,
    from: string,
    to: string,
  ): Promise<Record<string, number>> {
    const rows: Array<{ method: string; count: number }> =
      await this.dataSource.query(
        `SELECT method, SUM(count)::int AS count FROM stats_daily_identification
        WHERE date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR campaign_id = $3)
        GROUP BY method`,
        [from, to, campaignId],
      );
    return Object.fromEntries(rows.map((r) => [r.method, r.count]));
  }
}
