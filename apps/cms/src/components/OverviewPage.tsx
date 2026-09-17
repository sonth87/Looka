import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import {
  AllCampaignsStats,
  ApiError,
  CampaignsTimeseries,
  DashboardActiveCampaign,
  DashboardKpis,
  ReviewStats,
  breakdownCount,
  getAllCampaignsStats,
  getCampaignsTimeseries,
  getDashboardActiveCampaigns,
  getDashboardKpis,
  getReviewStats,
} from '../api';
import { METRIC_COLOR, NEUTRAL_ACCENT, CHROME, formatCount } from '../chartTheme';
import { KpiCard } from './KpiCard';
import { DEFAULT_PAGE_SIZE, Pager, paginateClientSide } from './Pager';
import {
  CampaignComparisonChart,
  CampaignQualityChart,
  DashboardPanel,
  LegendRow,
  PhotoStatusBreakdown,
  QualityTrendChart,
  SessionsTrendChart,
  TooltipCard,
  UploadOutcomeBreakdown,
  formatDayMonth,
} from './OverviewCharts';

const TREND_DAYS = 14;

type Tab = 'system' | 'active' | 'mine';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'system', label: 'Tổng quan hệ thống' },
  { key: 'active', label: 'Đợt đang hoạt động' },
  { key: 'mine', label: 'Hoạt động của tôi' },
];

function DashboardSkeleton() {
  const block = 'rounded-2xl bg-gray-100 border border-gray-200';
  return (
    <div className="animate-pulse space-y-8" aria-hidden="true">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-[72px] rounded-xl bg-gray-100 border border-gray-200" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`h-64 ${block}`} />
        <div className={`h-64 ${block}`} />
      </div>
    </div>
  );
}

/**
 * "Tổng quan" (`/`) — merges the old separate "Tổng quan" (`StatsOverview.tsx`,
 * system-wide analytics) and "Vận hành" (`DashboardPage.tsx`, active-campaign
 * operations) pages into one, as 3 tabs (plan item 11, 2026-09-17). They
 * weren't fully redundant — different grain (all-time/all-campaigns vs.
 * active-only-with-quota/overdue) and one section (`DashboardKpis.captured`)
 * is scoped to the signed-in admin's OWN activity, not system-wide — so this
 * keeps them as separate tabs sharing one page/one nav entry rather than
 * forcing everything into a single table or chart grid that doesn't share
 * columns. `StatsOverview.tsx`/`DashboardPage.tsx` are deleted (both fully
 * absorbed here, nothing else imported them).
 *
 * Every data source is fetched once up front (`Promise.allSettled`, so one
 * slow/failing endpoint doesn't block the others) and handed down to
 * whichever tab needs it, rather than re-fetching on every tab switch.
 */
export function OverviewPage() {
  const [tab, setTab] = useState<Tab>('system');

  const [stats, setStats] = useState<AllCampaignsStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [timeseries, setTimeseries] = useState<CampaignsTimeseries | null>(null);
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [activeCampaigns, setActiveCampaigns] = useState<DashboardActiveCampaign[] | null>(null);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);

  const [campaignsPage, setCampaignsPage] = useState(1);
  const [campaignsPageSize, setCampaignsPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [activePage, setActivePage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    getAllCampaignsStats()
      .then(setStats)
      .catch((err) => setStatsError(err instanceof ApiError ? err.message : String(err)));
    getCampaignsTimeseries(TREND_DAYS)
      .then(setTimeseries)
      .catch((err) => setTimeseriesError(err instanceof ApiError ? err.message : String(err)));

    Promise.allSettled([getDashboardKpis(), getDashboardActiveCampaigns(), getReviewStats()]).then(
      ([kpisRes, campaignsRes, reviewRes]) => {
        if (kpisRes.status === 'fulfilled') setKpis(kpisRes.value);
        if (campaignsRes.status === 'fulfilled') setActiveCampaigns(campaignsRes.value);
        if (reviewRes.status === 'fulfilled') setReviewStats(reviewRes.value);
        const firstError = [kpisRes, campaignsRes, reviewRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (firstError) setOpsError(firstError.reason instanceof ApiError ? firstError.reason.message : String(firstError.reason));
      }
    );
  }, []);

  const sessionsSpark = timeseries?.points.map((p) => p.sessionsCompleted);
  const uploadsSpark = timeseries?.points.map((p) => p.uploadsSuccess);
  const uploadsFailedSpark = timeseries?.points.map((p) => p.uploadsFailed);
  const retakesSpark = timeseries?.points.map((p) => p.retakes);

  const triggerTotals = stats?.campaigns.reduce<
    { AUTO: number; GESTURE: number; SHUTTER: number; EXTERNAL: number } | null
  >((acc, c) => {
    if (!c.byTrigger || c.byTrigger.length === 0) return acc;
    const base = acc ?? { AUTO: 0, GESTURE: 0, SHUTTER: 0, EXTERNAL: 0 };
    return {
      AUTO: base.AUTO + breakdownCount(c.byTrigger, 'AUTO'),
      GESTURE: base.GESTURE + breakdownCount(c.byTrigger, 'GESTURE'),
      SHUTTER: base.SHUTTER + breakdownCount(c.byTrigger, 'SHUTTER'),
      EXTERNAL: base.EXTERNAL + breakdownCount(c.byTrigger, 'EXTERNAL'),
    };
  }, null) ?? null;

  // Campaign-wide "chờ duyệt"/"quá hạn" totals — same sum-across-active-campaigns
  // DashboardPage used to do, now merged into the system-wide KPI row too.
  const opsTotals = (activeCampaigns ?? []).reduce(
    (acc, c) => ({ pendingReview: acc.pendingReview + c.pendingReview, overdue: acc.overdue + c.overdue }),
    { pendingReview: 0, overdue: 0 }
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Tổng quan</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'system' && (
        <SystemTab
          stats={stats}
          statsError={statsError}
          timeseries={timeseries}
          timeseriesError={timeseriesError}
          sessionsSpark={sessionsSpark}
          uploadsSpark={uploadsSpark}
          uploadsFailedSpark={uploadsFailedSpark}
          retakesSpark={retakesSpark}
          triggerTotals={triggerTotals}
          opsTotals={opsTotals}
          printed={kpis?.printed ?? 0}
          campaignsPage={campaignsPage}
          campaignsPageSize={campaignsPageSize}
          setCampaignsPage={setCampaignsPage}
          setCampaignsPageSize={setCampaignsPageSize}
        />
      )}

      {tab === 'active' && (
        <ActiveCampaignsTab
          error={opsError}
          campaigns={activeCampaigns}
          reviewStats={reviewStats}
          page={activePage}
          pageSize={activePageSize}
          setPage={setActivePage}
          setPageSize={setActivePageSize}
        />
      )}

      {tab === 'mine' && <MineTab error={opsError} kpis={kpis} />}
    </div>
  );
}

function SystemTab({
  stats,
  statsError,
  timeseries,
  timeseriesError,
  sessionsSpark,
  uploadsSpark,
  uploadsFailedSpark,
  retakesSpark,
  triggerTotals,
  opsTotals,
  printed,
  campaignsPage,
  campaignsPageSize,
  setCampaignsPage,
  setCampaignsPageSize,
}: {
  stats: AllCampaignsStats | null;
  statsError: string | null;
  timeseries: CampaignsTimeseries | null;
  timeseriesError: string | null;
  sessionsSpark?: number[];
  uploadsSpark?: number[];
  uploadsFailedSpark?: number[];
  retakesSpark?: number[];
  triggerTotals: { AUTO: number; GESTURE: number; SHUTTER: number; EXTERNAL: number } | null;
  opsTotals: { pendingReview: number; overdue: number };
  printed: number;
  campaignsPage: number;
  campaignsPageSize: number;
  setCampaignsPage: (p: number) => void;
  setCampaignsPageSize: (s: number) => void;
}) {
  if (statsError) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{statsError}</div>;
  if (!stats) return <DashboardSkeleton />;

  return (
    <div className="space-y-8">
      <section>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <KpiCard label="Campaign" value={stats.totalCampaigns} color={NEUTRAL_ACCENT} />
          <KpiCard label="Thiết bị" value={stats.totalDevices} color={METRIC_COLOR.devices} />
          <KpiCard label="Session hoàn tất" value={stats.totalSessionsCompleted} color={METRIC_COLOR.sessionsCompleted} sparklineValues={sessionsSpark} />
          <KpiCard label="Upload thành công" value={stats.totalUploadSuccess} color={METRIC_COLOR.uploadSuccess} sparklineValues={uploadsSpark} />
          <KpiCard label="Upload thất bại" value={stats.totalUploadFailed} color={METRIC_COLOR.uploadFailed} sparklineValues={uploadsFailedSpark} />
          <KpiCard label="Lần chụp lại" value={stats.totalRetakes} color={METRIC_COLOR.retakes} sparklineValues={retakesSpark} />
          <KpiCard label="CB Help can thiệp" value={stats.totalCbHelpInterventions} color={METRIC_COLOR.cbHelp} />
          <KpiCard label="Phiên chụp" value={stats.totalSessions} color={METRIC_COLOR.sessions} />
          <KpiCard label="Ảnh" value={stats.totalPhotos.total} color={NEUTRAL_ACCENT} />
          {/* Merged in from the old "Vận hành" page (plan item 11) — chờ duyệt/quá hạn summed across active campaigns, "đã in" from the admin's own dashboard KPIs (no system-wide print total exists yet). */}
          <KpiCard label="Đang chờ duyệt" value={opsTotals.pendingReview} color={METRIC_COLOR.pendingReview} />
          <KpiCard label="Quá hạn xử lý" value={opsTotals.overdue} color={METRIC_COLOR.overdue} />
          <KpiCard label="Đã in" value={printed} color={METRIC_COLOR.printed} />
          {triggerTotals && (
            <>
              <KpiCard label="Tự động" value={triggerTotals.AUTO} color={NEUTRAL_ACCENT} />
              <KpiCard label="Thủ công" value={triggerTotals.GESTURE + triggerTotals.SHUTTER} color={NEUTRAL_ACCENT} />
            </>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardPanel title="Xu hướng session & upload" subtitle="Session hoàn tất & upload thành công theo ngày, mọi campaign">
          {timeseriesError && <p className="text-red-600 text-sm">{timeseriesError}</p>}
          {!timeseries && !timeseriesError && <div className="h-[220px] rounded-xl bg-gray-50 animate-pulse" aria-hidden="true" />}
          {timeseries && <SessionsTrendChart points={timeseries.points} />}
        </DashboardPanel>

        <DashboardPanel title="Xu hướng chất lượng" subtitle="Chụp lại & upload lỗi theo ngày, mọi campaign">
          {timeseriesError && <p className="text-red-600 text-sm">{timeseriesError}</p>}
          {!timeseries && !timeseriesError && <div className="h-[220px] rounded-xl bg-gray-50 animate-pulse" aria-hidden="true" />}
          {timeseries && <QualityTrendChart points={timeseries.points} />}
        </DashboardPanel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DashboardPanel title="So sánh theo campaign" subtitle="Session hoàn tất & upload thành công" className="lg:col-span-2">
          {stats.campaigns.length === 0 ? <p className="text-gray-500 text-sm">Chưa có dữ liệu.</p> : <CampaignComparisonChart campaigns={stats.campaigns} />}
        </DashboardPanel>

        <DashboardPanel title="Trạng thái ảnh">
          {stats.totalPhotos.total === 0 ? <p className="text-gray-500 text-sm">Chưa có ảnh nào.</p> : <PhotoStatusBreakdown photos={stats.totalPhotos} />}
        </DashboardPanel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DashboardPanel title="Chất lượng theo campaign" subtitle="Chụp lại & CB Help can thiệp" className="lg:col-span-2">
          {stats.campaigns.length === 0 ? <p className="text-gray-500 text-sm">Chưa có dữ liệu.</p> : <CampaignQualityChart campaigns={stats.campaigns} />}
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
          {stats.campaigns.length > 0 && (() => {
            const { pageItems, meta } = paginateClientSide(stats.campaigns, campaignsPage, campaignsPageSize);
            return (
              <>
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
                      {pageItems.map((c) => (
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
                <Pager
                  meta={meta}
                  itemLabel="campaign"
                  onPageChange={setCampaignsPage}
                  pageSize={campaignsPageSize}
                  onPageSizeChange={(size) => {
                    setCampaignsPageSize(size);
                    setCampaignsPage(1);
                  }}
                />
              </>
            );
          })()}
        </DashboardPanel>
      </section>
    </div>
  );
}

function ActiveCampaignsTab({
  error,
  campaigns,
  reviewStats,
  page,
  pageSize,
  setPage,
  setPageSize,
}: {
  error: string | null;
  campaigns: DashboardActiveCampaign[] | null;
  reviewStats: ReviewStats | null;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
}) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        "Đang có phiên" = có phiên chụp bắt đầu trong 15 phút gần nhất — tín hiệu hoạt động gần nhất hiện có, không
        phải trạng thái online/offline thật của kiosk. Không có feed sự cố thời gian thực (chưa có dữ liệu backend).
      </p>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-6">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Các đợt chụp đang hoạt động</h2>
          {campaigns === null && !error && <p className="text-sm text-gray-500">Đang tải...</p>}
          {campaigns?.length === 0 && <p className="text-sm text-gray-500">Không có đợt chụp nào đang hoạt động.</p>}
          {campaigns && campaigns.length > 0 && (() => {
            const { pageItems, meta } = paginateClientSide(campaigns, page, pageSize);
            return (
              <>
                <div className="space-y-3">
                  {pageItems.map((c) => (
                    <ActiveCampaignRow key={c.campaignId} campaign={c} />
                  ))}
                </div>
                <Pager
                  meta={meta}
                  itemLabel="đợt chụp"
                  onPageChange={setPage}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              </>
            );
          })()}
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Kết quả duyệt ảnh</h2>
          {reviewStats === null && !error ? (
            <p className="text-sm text-gray-500">Đang tải...</p>
          ) : reviewStats ? (
            <ReviewOutcomeBreakdown stats={reviewStats} />
          ) : (
            <p className="text-sm text-gray-500">Không có dữ liệu.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MineTab({ error, kpis }: { error: string | null; kpis: DashboardKpis | null }) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Chỉ tính số ảnh do chính bạn (tài khoản đang đăng nhập) chụp — API chưa hỗ trợ tổng theo toàn hệ thống theo
        từng ngày.
      </p>
      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-6">{error}</div>}
      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Hoạt động của bạn theo ngày</h2>
        {kpis === null && !error && <p className="text-sm text-gray-500">Đang tải...</p>}
        {kpis && kpis.captured.byDay.length > 0 ? (
          <DailyCapturedChart byDay={kpis.captured.byDay} />
        ) : kpis ? (
          <p className="text-sm text-gray-500">Chưa có dữ liệu trong khoảng thời gian này.</p>
        ) : null}
      </div>
    </div>
  );
}

function ActiveCampaignRow({ campaign }: { campaign: DashboardActiveCampaign }) {
  const pct = campaign.quota ? Math.min(100, Math.round((campaign.captured / campaign.quota) * 100)) : null;
  return (
    <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-medium text-gray-900 text-sm truncate">{campaign.name}</span>
        {campaign.inProgressNow > 0 && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-medium">
            {campaign.inProgressNow} đang có phiên
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden mb-1.5">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: METRIC_COLOR.captured }} />
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>
          {formatCount(campaign.captured)}
          {campaign.quota ? ` / ${formatCount(campaign.quota)}` : ''} đã chụp
        </span>
        <span>{formatCount(campaign.sessions)} phiên</span>
        {campaign.pendingReview > 0 && <span style={{ color: METRIC_COLOR.pendingReview }}>{formatCount(campaign.pendingReview)} chờ duyệt</span>}
        {campaign.overdue > 0 && <span style={{ color: METRIC_COLOR.overdue }}>{formatCount(campaign.overdue)} quá hạn</span>}
        {campaign.captureErrors > 0 && <span className="text-red-600">{formatCount(campaign.captureErrors)} lỗi chụp</span>}
      </div>
    </div>
  );
}

function ReviewOutcomeBreakdown({ stats }: { stats: ReviewStats }) {
  const { approved, rejected, aiEdited, uploaded, autoOnly } = stats;
  const total = approved + rejected;
  const data = [{ name: 'Duyệt ảnh', approved, rejected }];

  function renderTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%');
    return (
      <TooltipCard
        title="Kết quả duyệt ảnh"
        rows={[
          { color: METRIC_COLOR.reviewApproved, shape: 'rect', label: 'Đã duyệt', value: `${formatCount(approved)} (${pct(approved)})` },
          { color: METRIC_COLOR.reviewRejected, shape: 'rect', label: 'Từ chối', value: `${formatCount(rejected)} (${pct(rejected)})` },
        ]}
      />
    );
  }

  if (total === 0) return <p className="text-sm text-gray-500">Chưa có hồ sơ nào được duyệt/từ chối</p>;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tabular-nums text-gray-900">{formatCount(total)}</span>
        <span className="text-sm text-gray-500">hồ sơ đã xử lý</span>
      </div>

      <div style={{ width: '100%', height: 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, total || 1]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="approved" stackId="a" fill={METRIC_COLOR.reviewApproved} stroke="#fff" strokeWidth={2} radius={[4, 0, 0, 4]} barSize={28} />
            <Bar dataKey="rejected" stackId="a" fill={METRIC_COLOR.reviewRejected} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-sm">
        <li>
          <LegendRow color={METRIC_COLOR.reviewApproved} shape="rect" label="Đã duyệt" value={formatCount(approved)} />
        </li>
        <li>
          <LegendRow color={METRIC_COLOR.reviewRejected} shape="rect" label="Từ chối" value={formatCount(rejected)} />
        </li>
      </ul>

      <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
        Trong số đã duyệt: {formatCount(autoOnly)} ảnh tự động, {formatCount(aiEdited)} sửa AI, {formatCount(uploaded)} tải lên thay thế.
      </p>
    </div>
  );
}

function DailyCapturedChart({ byDay }: { byDay: Array<{ date: string; count: number }> }) {
  function renderTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0 || typeof label !== 'string') return null;
    return (
      <TooltipCard
        title={formatDayMonth(label)}
        rows={[{ color: METRIC_COLOR.captured, shape: 'rect', label: 'Đã chụp', value: formatCount(Number(payload[0]?.value ?? 0)) }]}
      />
    );
  }

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHROME.gridline} />
          <XAxis dataKey="date" tickFormatter={formatDayMonth} stroke={CHROME.axisText} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke={CHROME.axisText} fontSize={12} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
          <Bar dataKey="count" fill={METRIC_COLOR.captured} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
