import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CaptureReportService } from '@app/modules/capture/services/capture-report.service';
import { PhotoReviewService } from '@app/modules/photo-review/services/photo-review.service';
import { CommonService } from '@app/modules/shared/common/common.service';
import {
  AllCampaignsStatsDao,
  CampaignDayStatsDao,
  CampaignDeviceStatsDao,
  CampaignOperatorStatsDao,
  CampaignPhotoStatsDao,
  CampaignsTimeseriesDao,
  CampaignsTimeseriesPointDao,
  CampaignStatsDao,
  CampaignStatsSummaryItemDao,
} from '../dao';
import { DeviceEventInput } from '../dto/create-device-events.dto';
import { Device } from '../entities/device.entity';
import { DeviceEvent, DeviceEventType } from '../entities/device-event.entity';

@Injectable()
export class DeviceEventService extends CommonService<DeviceEvent> {
  private readonly logger = new Logger(DeviceEventService.name);

  constructor(
    @InjectRepository(DeviceEvent)
    repository: Repository<DeviceEvent>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly captureReportService: CaptureReportService,
    private readonly photoReview: PhotoReviewService,
  ) {
    super(repository);
  }

  /**
   * Stores a batch as-is — no dedup, no idempotency key for the audit row
   * itself. Unlike `UploadOutboxRepository.enqueue()` (which a kiosk retries
   * against the exact same idem_key until it lands), a stats event is a
   * count, not a durable artifact: an occasional duplicate slightly
   * over-counts one number, which is a far smaller problem than the dedup
   * machinery needed to prevent it. Kept simple on purpose for a first
   * version.
   *
   * SESSION_REPORT/PHOTO_STATUS carry a full capture record rather than
   * just a count, so `CaptureReportService` applies them (upserting
   * sessions/photos) inside this SAME transaction, before the raw event row
   * below is saved — either both land or neither does. Those two upserts
   * are themselves idempotent (see `CaptureReportService`'s own doc
   * comment), so re-applying a duplicate batch is still harmless.
   */
  async recordBatch(
    deviceId: string,
    campaignId: string,
    events: DeviceEventInput[],
  ): Promise<number> {
    if (events.length === 0) return 0;

    // Collected while applying SESSION_REPORT events below, then used
    // AFTER the transaction commits (see the best-effort loop at the
    // bottom of this method) — never inside it, so a photo-review hiccup
    // can never roll back a batch of real capture-stats the kiosk already
    // committed to sending.
    const approvedSessionIds: string[] = [];

    const savedCount = await this.dataSource.transaction(async (manager) => {
      for (const event of events) {
        if (event.type === DeviceEventType.SESSION_REPORT) {
          await this.captureReportService.applySessionReport(
            manager,
            deviceId,
            campaignId,
            event.metadata,
          );
          const sessionId = (event.metadata as { sessionId?: unknown } | null)?.sessionId;
          if (typeof sessionId === 'string') approvedSessionIds.push(sessionId);
        } else if (event.type === DeviceEventType.PHOTO_STATUS) {
          await this.captureReportService.applyPhotoStatus(
            manager,
            deviceId,
            campaignId,
            event.metadata,
          );
        } else if (event.type === DeviceEventType.VIDEO_STATUS) {
          await this.captureReportService.applyVideoStatus(
            manager,
            deviceId,
            campaignId,
            event.metadata,
          );
        } else if (event.type === DeviceEventType.ATTEMPT_SUPERSEDED) {
          await this.captureReportService.applyAttemptSuperseded(
            manager,
            event.metadata,
          );
        }
      }

      const rows = this.creates(
        events.map((e) => ({
          deviceId,
          campaignId,
          type: e.type,
          occurredAt: new Date(e.occurredAt),
          metadata: e.metadata ?? null,
        })),
      );
      const saved = await this.saveMultiWithTransaction(manager, rows);
      return saved.length;
    });

    // Best-effort, outside the transaction — same reasoning as
    // `SessionService.completeSession`'s identical hook for the web path
    // (see that method's own comment). A `SESSION_REPORT` batch can legally
    // report several sessions at once (a kiosk pushes its queue every
    // 15s — see docs/ROADMAP.md), so this is a small loop, not a single call.
    //
    // Auto-triggers the set's first `CARD_AUTO` the moment it lands in
    // `PENDING_AUTO` — `PhotoReviewService.ensureSetForApprovedSession`'s own
    // doc comment used to note this pass had no such worker, leaving an
    // admin to click "reprocess" manually for every single student forever;
    // this closes that gap by calling the exact same `reprocess()` logic the
    // manual button already uses, right here, best-effort. Only fires when
    // `ensureSetForApprovedSession` actually produced/reset a `PENDING_AUTO`
    // set (`pendingAuto: true`) — an already-`APPROVED` set (R-Q10) must
    // never have this silently overwrite what a reviewer already accepted.
    // `reprocess()` itself never throws for a sidecar failure (it resolves
    // to a clean `AUTO_FAILED` state on its own — see that method's own
    // comment), so the `.catch()` here only guards against something truly
    // unexpected (e.g. a DB hiccup) — same belt-and-braces pattern as the
    // `ensureSetForApprovedSession` call right above it. `actorUserId: null`
    // marks this as a system-triggered run, same as `reprocess()`'s own
    // `AUTO_GENERATED`/`AUTO_FAILED` events already do for the sidecar
    // outcome itself. Once Part A of the capture-routing work has landed,
    // the source photo's bytes are already in this API's own Postgres by
    // the time this runs (no upload to fs-core to wait on first) — see
    // `PhotoReviewService.readSourcePhotoBytes`.
    for (const sessionId of approvedSessionIds) {
      const result = await this.photoReview.ensureSetForApprovedSession(sessionId).catch((err) => {
        this.logger.warn(
          `best-effort photo-review set creation failed for session ${sessionId}: ${(err as Error).message}`,
        );
        return null;
      });
      if (result?.pendingAuto) {
        await this.photoReview.reprocess(result.setId, null).catch((err) => {
          this.logger.warn(
            `best-effort auto CARD_AUTO reprocess failed for set ${result.setId} (session ${sessionId}): ${(err as Error).message}`,
          );
        });
      }
    }

    return savedCount;
  }

  /**
   * The "tối thiểu cần có" snapshot from that doc's §3.4 — event-type counts,
   * plus (A.8) the capture-record aggregates computed from `sessions`/
   * `photos` directly: how many sessions this campaign has actually
   * completed, its photos' upload state, a per-device breakdown, and a
   * 30-day daily series.
   */
  async campaignStats(campaignId: string): Promise<CampaignStatsDao> {
    const deviceCount = await this.deviceRepository.count({
      where: { campaignId },
    });

    const rows = await this.repository
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('e.campaign_id = :campaignId', { campaignId })
      .groupBy('e.type')
      .getRawMany<{ type: DeviceEventType; count: string }>();

    const countByType = new Map(rows.map((r) => [r.type, Number(r.count)]));

    const stats = new CampaignStatsDao();
    stats.campaignId = campaignId;
    stats.deviceCount = deviceCount;
    stats.sessionsCompleted =
      countByType.get(DeviceEventType.SESSION_COMPLETED) ?? 0;
    stats.uploadSuccess = countByType.get(DeviceEventType.UPLOAD_SUCCESS) ?? 0;
    stats.uploadFailed = countByType.get(DeviceEventType.UPLOAD_FAILED) ?? 0;
    stats.retakes = countByType.get(DeviceEventType.RETAKE) ?? 0;
    stats.cbHelpInterventions =
      countByType.get(DeviceEventType.CB_HELP_INTERVENTION) ?? 0;

    const [sessionRow] = await this.dataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM sessions WHERE campaign_id = $1 AND status = 'COMPLETED'`,
      [campaignId],
    );
    stats.sessions = sessionRow?.count ?? 0;
    stats.photos = await this.campaignPhotoStats(campaignId);
    stats.byDevice = await this.campaignDeviceStats(campaignId);
    stats.byOperator = await this.campaignOperatorStats(campaignId);
    stats.byDay = await this.campaignDayStats(campaignId);

    return stats;
  }

  /**
   * Same counts as `campaignStats()`, summed across every campaign, plus the
   * per-campaign breakdown they were summed from — for the CMS's overview
   * page (see `AllCampaignsStatsDao`'s own doc comment). The event-type and
   * A.8 aggregates are each one query grouped by campaign_id, not one call
   * to `campaignStats()` per campaign, so this stays cheap regardless of how
   * many campaigns exist.
   *
   * `campaigns` is supplied by the caller (`CampaignController`, via
   * `CampaignService.findAllCampaigns()`) rather than queried here — this
   * service owns event/device/capture-record counts, not campaign identity,
   * matching how `campaignStats()` already leaves campaign-existence checks
   * to the controller.
   */
  async allCampaignsStats(
    campaigns: { id: string; name: string }[],
  ): Promise<AllCampaignsStatsDao> {
    const deviceRows = await this.deviceRepository
      .createQueryBuilder('d')
      .select('d.campaign_id', 'campaignId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.campaign_id')
      .getRawMany<{ campaignId: string; count: string }>();
    const deviceCountByCampaign = new Map(
      deviceRows.map((r) => [r.campaignId, Number(r.count)]),
    );

    const eventRows = await this.repository
      .createQueryBuilder('e')
      .select('e.campaign_id', 'campaignId')
      .addSelect('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.campaign_id')
      .addGroupBy('e.type')
      .getRawMany<{
        campaignId: string;
        type: DeviceEventType;
        count: string;
      }>();
    const eventCountByCampaign = new Map<
      string,
      Map<DeviceEventType, number>
    >();
    for (const row of eventRows) {
      if (!eventCountByCampaign.has(row.campaignId))
        eventCountByCampaign.set(row.campaignId, new Map());
      eventCountByCampaign
        .get(row.campaignId)!
        .set(row.type, Number(row.count));
    }

    const sessionCountByCampaign = await this.bulkSessionCounts();
    const photoStatsByCampaign = await this.bulkPhotoStats();
    const deviceStatsByCampaign = await this.bulkDeviceStats();
    const dayStatsByCampaign = await this.bulkDayStats();

    const summary = new AllCampaignsStatsDao();
    summary.totalCampaigns = campaigns.length;
    summary.totalDevices = 0;
    summary.totalSessionsCompleted = 0;
    summary.totalUploadSuccess = 0;
    summary.totalUploadFailed = 0;
    summary.totalRetakes = 0;
    summary.totalCbHelpInterventions = 0;
    summary.totalSessions = 0;
    summary.totalPhotos = { total: 0, ready: 0, pending: 0, failed: 0 };

    summary.campaigns = campaigns.map((campaign) => {
      const countByType =
        eventCountByCampaign.get(campaign.id) ??
        new Map<DeviceEventType, number>();
      const item = new CampaignStatsSummaryItemDao();
      item.campaignId = campaign.id;
      item.campaignName = campaign.name;
      item.deviceCount = deviceCountByCampaign.get(campaign.id) ?? 0;
      item.sessionsCompleted =
        countByType.get(DeviceEventType.SESSION_COMPLETED) ?? 0;
      item.uploadSuccess = countByType.get(DeviceEventType.UPLOAD_SUCCESS) ?? 0;
      item.uploadFailed = countByType.get(DeviceEventType.UPLOAD_FAILED) ?? 0;
      item.retakes = countByType.get(DeviceEventType.RETAKE) ?? 0;
      item.cbHelpInterventions =
        countByType.get(DeviceEventType.CB_HELP_INTERVENTION) ?? 0;
      item.sessions = sessionCountByCampaign.get(campaign.id) ?? 0;
      item.photos = photoStatsByCampaign.get(campaign.id) ?? {
        total: 0,
        ready: 0,
        pending: 0,
        failed: 0,
      };
      item.byDevice = deviceStatsByCampaign.get(campaign.id) ?? [];
      // Per-operator breakdown is only computed for the single-campaign
      // `campaignStats()` (the campaign detail's own Thống kê tab, where it
      // was actually asked for) — no bulk per-campaign query exists for the
      // cross-campaign overview page this method backs, so this stays empty
      // here rather than adding N+1 queries for a summary table that never
      // asked to show it.
      item.byOperator = [];
      item.byDay = dayStatsByCampaign.get(campaign.id) ?? [];

      summary.totalDevices += item.deviceCount;
      summary.totalSessionsCompleted += item.sessionsCompleted;
      summary.totalUploadSuccess += item.uploadSuccess;
      summary.totalUploadFailed += item.uploadFailed;
      summary.totalRetakes += item.retakes;
      summary.totalCbHelpInterventions += item.cbHelpInterventions;
      summary.totalSessions += item.sessions;
      summary.totalPhotos.total += item.photos.total;
      summary.totalPhotos.ready += item.photos.ready;
      summary.totalPhotos.pending += item.photos.pending;
      summary.totalPhotos.failed += item.photos.failed;

      return item;
    });

    return summary;
  }

  /** Fixed Asia/Ho_Chi_Minh offset (no DST) — lets `campaignsTimeseries` compute "today" in kiosk-local terms without a timezone-parsing library. */
  private static readonly VN_OFFSET_MS = 7 * 60 * 60 * 1000;

  /**
   * Day-bucketed sessions-completed / uploads-success/failed / retake series
   * across every campaign, for the Overview page's trend charts (2026-09-07
   * dashboard redesign — see `CampaignsTimeseriesDao`'s own doc comment).
   * Reuses the exact event types already summed into `allCampaignsStats()`'s
   * `total*` fields, just grouped by day instead of by campaign, so every
   * trend line agrees with the KPI totals and per-campaign charts shown
   * alongside it. `UPLOAD_FAILED`/`RETAKE` were folded into this same query
   * (rather than a separate endpoint) on 2026-09-07 once the product owner
   * asked for those two metrics to stop being "just a number" — it's the
   * same grouped query with two more types in the `IN` list, not new
   * aggregation logic.
   */
  async campaignsTimeseries(days: number): Promise<CampaignsTimeseriesDao> {
    const rows = await this.dataSource.query<
      Array<{ date: string; type: DeviceEventType; count: number }>
    >(
      `SELECT
          to_char(date_trunc('day', occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
          type,
          COUNT(*)::int AS count
         FROM device_events
        WHERE type IN ('SESSION_COMPLETED', 'UPLOAD_SUCCESS', 'UPLOAD_FAILED', 'RETAKE')
          AND occurred_at >= now() - make_interval(days => $1::int)
        GROUP BY 1, 2
        ORDER BY 1`,
      [days],
    );

    const byDate = new Map<
      string,
      {
        sessionsCompleted: number;
        uploadsSuccess: number;
        uploadsFailed: number;
        retakes: number;
      }
    >();
    for (const row of rows) {
      const entry = byDate.get(row.date) ?? {
        sessionsCompleted: 0,
        uploadsSuccess: 0,
        uploadsFailed: 0,
        retakes: 0,
      };
      if (row.type === DeviceEventType.SESSION_COMPLETED) {
        entry.sessionsCompleted = Number(row.count);
      } else if (row.type === DeviceEventType.UPLOAD_SUCCESS) {
        entry.uploadsSuccess = Number(row.count);
      } else if (row.type === DeviceEventType.UPLOAD_FAILED) {
        entry.uploadsFailed = Number(row.count);
      } else if (row.type === DeviceEventType.RETAKE) {
        entry.retakes = Number(row.count);
      }
      byDate.set(row.date, entry);
    }

    // Fill every day in the window, even ones with zero events, so the line
    // chart never shows a gap. "+7h then read the UTC date parts" reproduces
    // the Asia/Ho_Chi_Minh calendar date without a timezone library, mirroring
    // the SQL bucketing above (VN has no DST, so this fixed offset is exact).
    const dao = new CampaignsTimeseriesDao();
    dao.points = [];
    const nowVn = new Date(Date.now() + DeviceEventService.VN_OFFSET_MS);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(nowVn);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? {
        sessionsCompleted: 0,
        uploadsSuccess: 0,
        uploadsFailed: 0,
        retakes: 0,
      };
      const point = new CampaignsTimeseriesPointDao();
      point.date = date;
      point.sessionsCompleted = entry.sessionsCompleted;
      point.uploadsSuccess = entry.uploadsSuccess;
      point.uploadsFailed = entry.uploadsFailed;
      point.retakes = entry.retakes;
      dao.points.push(point);
    }
    return dao;
  }

  private async campaignPhotoStats(
    campaignId: string,
  ): Promise<CampaignPhotoStatsDao> {
    const [row] = await this.dataSource.query<
      Array<{ total: number; ready: number; failed: number }>
    >(
      `SELECT
          COUNT(p.id)::int AS total,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS failed
         FROM photos p
         JOIN sessions s ON s.id = p.session_id
        WHERE s.campaign_id = $1`,
      [campaignId],
    );

    const dao = new CampaignPhotoStatsDao();
    dao.total = row?.total ?? 0;
    dao.ready = row?.ready ?? 0;
    dao.failed = row?.failed ?? 0;
    dao.pending = dao.total - dao.ready - dao.failed;
    return dao;
  }

  private async campaignDeviceStats(
    campaignId: string,
  ): Promise<CampaignDeviceStatsDao[]> {
    const rows = await this.dataSource.query<
      Array<{
        device_id: string;
        device_name: string;
        sessions: number;
        photos_ready: number;
        photos_failed: number;
        last_capture_at: Date | null;
      }>
    >(
      `SELECT
          s.device_id, d.name AS device_name,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS sessions,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS photos_ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS photos_failed,
          MAX(COALESCE(s.captured_at, s.created_at)) AS last_capture_at
         FROM sessions s
         LEFT JOIN devices d ON d.id = s.device_id
         LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.campaign_id = $1 AND s.device_id IS NOT NULL
        GROUP BY s.device_id, d.name
        ORDER BY d.name`,
      [campaignId],
    );

    return rows.map((r) => this.toDeviceStatsDao(r));
  }

  /**
   * Per-operator breakdown (2026-09-09, product request — "thống kê phần
   * giảng viên chụp" in the campaign detail's own Thống kê tab) — same
   * shape/query style as `campaignDeviceStats` above, grouped by
   * `sessions.operator_user_id` instead of `device_id`. A session with no
   * operator identity (kiosk build/session that predates threading the SSO
   * user through to capture — see `uploads.ts`'s `operatorUserId` plumbing)
   * groups under `operator_user_id IS NULL`, reported as one row rather than
   * silently dropped, so the total across `byOperator` still reconciles with
   * `stats.sessions`.
   */
  private async campaignOperatorStats(
    campaignId: string,
  ): Promise<CampaignOperatorStatsDao[]> {
    const rows = await this.dataSource.query<
      Array<{
        operator_user_id: string | null;
        operator_name: string | null;
        sessions: number;
        photos_ready: number;
        photos_failed: number;
        last_capture_at: Date | null;
      }>
    >(
      `SELECT
          s.operator_user_id,
          COALESCE(u.display_name, u.email) AS operator_name,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS sessions,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS photos_ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS photos_failed,
          MAX(COALESCE(s.captured_at, s.created_at)) AS last_capture_at
         FROM sessions s
         LEFT JOIN users u ON u.id = s.operator_user_id
         LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.campaign_id = $1
        GROUP BY s.operator_user_id, u.display_name, u.email
        ORDER BY operator_name NULLS LAST`,
      [campaignId],
    );

    return rows.map((r) => {
      const dao = new CampaignOperatorStatsDao();
      dao.operatorUserId = r.operator_user_id;
      dao.operatorName = r.operator_name ?? 'Không rõ (chưa đăng nhập SSO khi chụp)';
      dao.sessions = r.sessions;
      dao.photosReady = r.photos_ready;
      dao.photosFailed = r.photos_failed;
      dao.lastCaptureAt = r.last_capture_at ?? undefined;
      return dao;
    });
  }

  /** Last 30 days, bucketed in the kiosks' own timezone (A.8) — not UTC, so "today" lines up with what an operator in Vietnam actually did today. */
  private async campaignDayStats(
    campaignId: string,
  ): Promise<CampaignDayStatsDao[]> {
    const rows = await this.dataSource.query<
      Array<{ date: string; sessions: number; photos: number }>
    >(
      `SELECT
          to_char(date_trunc('day', COALESCE(s.captured_at, s.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS sessions,
          COUNT(p.id)::int AS photos
         FROM sessions s
         LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.campaign_id = $1
          AND COALESCE(s.captured_at, s.created_at) >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1`,
      [campaignId],
    );

    return rows.map((r) => {
      const dao = new CampaignDayStatsDao();
      dao.date = r.date;
      dao.sessions = r.sessions;
      dao.photos = r.photos;
      return dao;
    });
  }

  /** Bulk (all-campaigns) counterpart of the `sessions`/campaignStats() field above — one grouped query instead of one per campaign. */
  private async bulkSessionCounts(): Promise<Map<string, number>> {
    const rows: Array<{ campaign_id: string; count: number }> =
      await this.dataSource.query(
        `SELECT campaign_id, COUNT(*)::int AS count
         FROM sessions
        WHERE status = 'COMPLETED' AND campaign_id IS NOT NULL
        GROUP BY campaign_id`,
      );
    return new Map(rows.map((r) => [r.campaign_id, r.count]));
  }

  /** Bulk counterpart of `campaignPhotoStats` — one grouped query for every campaign. */
  private async bulkPhotoStats(): Promise<Map<string, CampaignPhotoStatsDao>> {
    const rows: Array<{
      campaign_id: string;
      total: number;
      ready: number;
      failed: number;
    }> = await this.dataSource.query(
      `SELECT
            s.campaign_id,
            COUNT(p.id)::int AS total,
            COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS ready,
            COUNT(*) FILTER (
              WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
            )::int AS failed
           FROM sessions s
           JOIN photos p ON p.session_id = s.id
          WHERE s.campaign_id IS NOT NULL
          GROUP BY s.campaign_id`,
    );

    const map = new Map<string, CampaignPhotoStatsDao>();
    for (const r of rows) {
      const dao = new CampaignPhotoStatsDao();
      dao.total = r.total;
      dao.ready = r.ready;
      dao.failed = r.failed;
      dao.pending = r.total - r.ready - r.failed;
      map.set(r.campaign_id, dao);
    }
    return map;
  }

  /** Bulk counterpart of `campaignDeviceStats` — one grouped query for every campaign. */
  private async bulkDeviceStats(): Promise<
    Map<string, CampaignDeviceStatsDao[]>
  > {
    const rows: Array<{
      campaign_id: string;
      device_id: string;
      device_name: string;
      sessions: number;
      photos_ready: number;
      photos_failed: number;
      last_capture_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT
          s.campaign_id, s.device_id, d.name AS device_name,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS sessions,
          COUNT(*) FILTER (WHERE p.fs_status = 'READY')::int AS photos_ready,
          COUNT(*) FILTER (
            WHERE p.local_status = 'FAILED_PERMANENT' OR p.fs_status IN ('QUARANTINED', 'FAILED')
          )::int AS photos_failed,
          MAX(COALESCE(s.captured_at, s.created_at)) AS last_capture_at
         FROM sessions s
         LEFT JOIN devices d ON d.id = s.device_id
         LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.campaign_id IS NOT NULL AND s.device_id IS NOT NULL
        GROUP BY s.campaign_id, s.device_id, d.name
        ORDER BY d.name`,
    );

    const map = new Map<string, CampaignDeviceStatsDao[]>();
    for (const r of rows) {
      if (!map.has(r.campaign_id)) map.set(r.campaign_id, []);
      map.get(r.campaign_id)!.push(this.toDeviceStatsDao(r));
    }
    return map;
  }

  /** Bulk counterpart of `campaignDayStats` — one grouped query for every campaign. */
  private async bulkDayStats(): Promise<Map<string, CampaignDayStatsDao[]>> {
    const rows: Array<{
      campaign_id: string;
      date: string;
      sessions: number;
      photos: number;
    }> = await this.dataSource.query(
      `SELECT
            s.campaign_id,
            to_char(date_trunc('day', COALESCE(s.captured_at, s.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS date,
            COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED')::int AS sessions,
            COUNT(p.id)::int AS photos
           FROM sessions s
           LEFT JOIN photos p ON p.session_id = s.id
          WHERE s.campaign_id IS NOT NULL
            AND COALESCE(s.captured_at, s.created_at) >= now() - interval '30 days'
          GROUP BY s.campaign_id, 2
          ORDER BY s.campaign_id, 2`,
    );

    const map = new Map<string, CampaignDayStatsDao[]>();
    for (const r of rows) {
      const dao = new CampaignDayStatsDao();
      dao.date = r.date;
      dao.sessions = r.sessions;
      dao.photos = r.photos;
      if (!map.has(r.campaign_id)) map.set(r.campaign_id, []);
      map.get(r.campaign_id)!.push(dao);
    }
    return map;
  }

  private toDeviceStatsDao(r: {
    device_id: string;
    device_name: string;
    sessions: number;
    photos_ready: number;
    photos_failed: number;
    last_capture_at: Date | null;
  }): CampaignDeviceStatsDao {
    const dao = new CampaignDeviceStatsDao();
    dao.deviceId = r.device_id;
    dao.deviceName = r.device_name;
    dao.sessions = r.sessions;
    dao.photosReady = r.photos_ready;
    dao.photosFailed = r.photos_failed;
    dao.lastCaptureAt = r.last_capture_at ?? undefined;
    return dao;
  }
}
