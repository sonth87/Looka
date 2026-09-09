import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AllCampaignsStats,
  ApiError,
  CampaignsTimeseries,
  getAllCampaignsStats,
  getCampaignsTimeseries,
} from '../api';
import { METRIC_COLOR, NEUTRAL_ACCENT } from '../chartTheme';
import { KpiCard } from './KpiCard';
import {
  CampaignComparisonChart,
  CampaignQualityChart,
  DashboardPanel,
  PhotoStatusBreakdown,
  QualityTrendChart,
  SessionsTrendChart,
  UploadOutcomeBreakdown,
} from './OverviewCharts';

/** How many trailing days the trend chart (and KPI sparklines) show — matches the server default, passed explicitly so this page doesn't silently drift if that default ever changes. */
const TREND_DAYS = 14;

/** Skeleton placeholder shown while the dashboard's data is loading — shaped like the real grid (KPI row, trend panel, chart row, table) so the page doesn't jump when data arrives, per the redesign brief's "look intentional, not a bare string" ask. */
function DashboardSkeleton() {
  const block = 'rounded-2xl bg-gray-100 border border-gray-200';
  return (
    <div className="animate-pulse space-y-8" aria-hidden="true">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className={`h-[72px] rounded-xl bg-gray-100 border border-gray-200`} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`h-64 ${block}`} />
        <div className={`h-64 ${block}`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`lg:col-span-2 h-72 ${block}`} />
        <div className={`h-72 ${block}`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`lg:col-span-2 h-72 ${block}`} />
        <div className={`h-72 ${block}`} />
      </div>
      <div className={`h-56 ${block}`} />
    </div>
  );
}

/**
 * Landing page for the CMS (`/`) — a Power BI–style analytics dashboard
 * (2026-09-07 redesign, product request: "thiết kế lại trang tổng quan theo
 * chuẩn PowerBI dashboard"; chart-density follow-up same day, product
 * request: "Trang tổng quan cần nhiều biểu đồ hơn thay vì những [phần] chỉ
 * có tag của những con số"). Structure, top to bottom:
 *
 *  1. KPI row — every grand total from `GET /v1/campaigns/stats/summary`,
 *     restyled as accent-colored stat cards; four metrics with a real
 *     day-bucketed series (session/upload/upload-failed/retake) also carry
 *     a 14-day sparkline.
 *  2. Two trend panels side by side — sessions/uploads (the original
 *     headline chart) and a second "chất lượng" panel (retakes/upload
 *     failures), both from `GET /v1/campaigns/stats/timeseries`, which was
 *     extended 2026-09-07 to bucket those two extra event types alongside
 *     the original pair (see docs/ROADMAP.md).
 *  3. Comparison + photo-status panels, side by side.
 *  4. Quality (retakes/CB Help, per campaign) + upload-outcome (success vs.
 *     failed, matching the photo-status treatment) panels, side by side —
 *     added the same day so `totalRetakes`/`totalCbHelpInterventions`/
 *     `totalUploadFailed` stop being flat numbers with no chart anywhere.
 *  5. The per-campaign table, as its own panel in the same grid — same card
 *     treatment as every chart above it, not a separate list dumped below,
 *     and still the place for exact per-campaign numbers.
 *
 * Chart implementation, color system, and interactivity choices are
 * documented in `OverviewCharts.tsx`'s own doc comment; the color mapping
 * shared between KPI cards and charts lives in `chartTheme.ts`.
 *
 * Stats and the trend series are fetched independently: a failure or slow
 * response on the (new, less-proven) timeseries endpoint degrades the trend
 * panels and KPI sparklines alone, rather than blocking the whole dashboard.
 */
export function StatsOverview() {
  const [stats, setStats] = useState<AllCampaignsStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [timeseries, setTimeseries] = useState<CampaignsTimeseries | null>(null);
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null);

  useEffect(() => {
    getAllCampaignsStats()
      .then(setStats)
      .catch((err) => setStatsError(err instanceof ApiError ? err.message : String(err)));

    getCampaignsTimeseries(TREND_DAYS)
      .then(setTimeseries)
      .catch((err) => setTimeseriesError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const sessionsSpark = timeseries?.points.map((p) => p.sessionsCompleted);
  const uploadsSpark = timeseries?.points.map((p) => p.uploadsSuccess);
  const uploadsFailedSpark = timeseries?.points.map((p) => p.uploadsFailed);
  const retakesSpark = timeseries?.points.map((p) => p.retakes);

  /**
   * Cross-campaign "Tự động"/"Thủ công" totals (ui-redesign-plan.md C1) —
   * `AllCampaignsStats` has no dedicated total field for this (it wasn't
   * part of the original stats/summary shape), so this sums each campaign's
   * own optional `byTrigger` client-side. `null` — not zeros — when not a
   * single campaign carries `byTrigger` yet, so the tiles below can hide
   * entirely rather than show a misleading "0" against an unshipped field.
   */
  const triggerTotals = stats?.campaigns.reduce<
    { AUTO: number; GESTURE: number; SHUTTER: number; EXTERNAL: number } | null
  >((acc, c) => {
    if (!c.byTrigger) return acc;
    const base = acc ?? { AUTO: 0, GESTURE: 0, SHUTTER: 0, EXTERNAL: 0 };
    return {
      AUTO: base.AUTO + c.byTrigger.AUTO,
      GESTURE: base.GESTURE + c.byTrigger.GESTURE,
      SHUTTER: base.SHUTTER + c.byTrigger.SHUTTER,
      EXTERNAL: base.EXTERNAL + c.byTrigger.EXTERNAL,
    };
  }, null) ?? null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Tổng quan</h1>

      {statsError && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{statsError}</div>}

      {!stats && !statsError && <DashboardSkeleton />}

      {stats && (
        <div className="space-y-8">
          <section>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <KpiCard label="Campaign" value={stats.totalCampaigns} color={NEUTRAL_ACCENT} />
              <KpiCard label="Thiết bị" value={stats.totalDevices} color={METRIC_COLOR.devices} />
              <KpiCard
                label="Session hoàn tất"
                value={stats.totalSessionsCompleted}
                color={METRIC_COLOR.sessionsCompleted}
                sparklineValues={sessionsSpark}
              />
              <KpiCard
                label="Upload thành công"
                value={stats.totalUploadSuccess}
                color={METRIC_COLOR.uploadSuccess}
                sparklineValues={uploadsSpark}
              />
              <KpiCard
                label="Upload thất bại"
                value={stats.totalUploadFailed}
                color={METRIC_COLOR.uploadFailed}
                sparklineValues={uploadsFailedSpark}
              />
              <KpiCard
                label="Lần chụp lại"
                value={stats.totalRetakes}
                color={METRIC_COLOR.retakes}
                sparklineValues={retakesSpark}
              />
              <KpiCard label="CB Help can thiệp" value={stats.totalCbHelpInterventions} color={METRIC_COLOR.cbHelp} />
              <KpiCard label="Phiên chụp" value={stats.totalSessions} color={METRIC_COLOR.sessions} />
              {/* totalPhotos is a breakdown object ({ total, ready, pending, failed }), not a bare
                  count - see CampaignPhotoStats in api.ts - so the tile shows its .total; the
                  breakdown itself is the status panel below. */}
              <KpiCard label="Ảnh" value={stats.totalPhotos.total} color={NEUTRAL_ACCENT} />
              {triggerTotals && (
                <>
                  {/* NEUTRAL_ACCENT reused for both — every categorical hue in chartTheme.ts's
                      fixed 6-slot palette is already claimed by another tracked metric, and
                      reusing a STATUS color here would wrongly imply "Thủ công" is a bad state. */}
                  <KpiCard label="Tự động" value={triggerTotals.AUTO} color={NEUTRAL_ACCENT} />
                  <KpiCard label="Thủ công" value={triggerTotals.GESTURE + triggerTotals.SHUTTER} color={NEUTRAL_ACCENT} />
                </>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DashboardPanel
              title="Xu hướng session & upload"
              subtitle="Session hoàn tất & upload thành công theo ngày, mọi campaign"
            >
              {timeseriesError && (
                <p className="text-red-600 text-sm">{timeseriesError}</p>
              )}
              {!timeseries && !timeseriesError && (
                <div className="h-[220px] rounded-xl bg-gray-50 animate-pulse" aria-hidden="true" />
              )}
              {timeseries && <SessionsTrendChart points={timeseries.points} />}
            </DashboardPanel>

            <DashboardPanel
              title="Xu hướng chất lượng"
              subtitle="Chụp lại & upload lỗi theo ngày, mọi campaign"
            >
              {timeseriesError && (
                <p className="text-red-600 text-sm">{timeseriesError}</p>
              )}
              {!timeseries && !timeseriesError && (
                <div className="h-[220px] rounded-xl bg-gray-50 animate-pulse" aria-hidden="true" />
              )}
              {timeseries && <QualityTrendChart points={timeseries.points} />}
            </DashboardPanel>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <DashboardPanel
              title="So sánh theo campaign"
              subtitle="Session hoàn tất & upload thành công"
              className="lg:col-span-2"
            >
              {stats.campaigns.length === 0 ? (
                <p className="text-gray-500 text-sm">Chưa có dữ liệu.</p>
              ) : (
                <CampaignComparisonChart campaigns={stats.campaigns} />
              )}
            </DashboardPanel>

            <DashboardPanel title="Trạng thái ảnh">
              {stats.totalPhotos.total === 0 ? (
                <p className="text-gray-500 text-sm">Chưa có ảnh nào.</p>
              ) : (
                <PhotoStatusBreakdown photos={stats.totalPhotos} />
              )}
            </DashboardPanel>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <DashboardPanel
              title="Chất lượng theo campaign"
              subtitle="Chụp lại & CB Help can thiệp"
              className="lg:col-span-2"
            >
              {stats.campaigns.length === 0 ? (
                <p className="text-gray-500 text-sm">Chưa có dữ liệu.</p>
              ) : (
                <CampaignQualityChart campaigns={stats.campaigns} />
              )}
            </DashboardPanel>

            <DashboardPanel title="Kết quả upload">
              {stats.totalUploadSuccess + stats.totalUploadFailed === 0 ? (
                <p className="text-gray-500 text-sm">Chưa có lượt upload nào.</p>
              ) : (
                <UploadOutcomeBreakdown uploadSuccess={stats.totalUploadSuccess} uploadFailed={stats.totalUploadFailed} />
              )}
            </DashboardPanel>
          </section>

          <section>
            <DashboardPanel title="Danh sách theo từng campaign">
              {stats.campaigns.length === 0 && <p className="text-gray-500 text-sm">Chưa có campaign nào.</p>}

              {stats.campaigns.length > 0 && (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="py-2.5 px-4">Campaign</th>
                        <th className="py-2.5 px-4">Thiết bị</th>
                        <th className="py-2.5 px-4">Session hoàn tất</th>
                        <th className="py-2.5 px-4">Upload OK</th>
                        <th className="py-2.5 px-4">Upload lỗi</th>
                        <th className="py-2.5 px-4">Chụp lại</th>
                        <th className="py-2.5 px-4">CB Help</th>
                        <th className="py-2.5 px-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {stats.campaigns.map((c) => (
                        <tr key={c.campaignId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-2.5 px-4 font-medium text-gray-900">{c.campaignName}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.deviceCount}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.sessionsCompleted}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.uploadSuccess}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.uploadFailed}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.retakes}</td>
                          <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.cbHelpInterventions}</td>
                          <td className="py-2.5 px-4 text-right">
                            <Link to={`/campaigns/${c.campaignId}`} className="text-blue-600 hover:text-blue-800 font-medium">
                              Xem →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DashboardPanel>
          </section>
        </div>
      )}
    </div>
  );
}
