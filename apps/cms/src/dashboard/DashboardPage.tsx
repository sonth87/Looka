import { useEffect, useState } from 'react';
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
  ApiError,
  DashboardActiveCampaign,
  DashboardKpis,
  ReviewStats,
  getDashboardActiveCampaigns,
  getDashboardKpis,
  getReviewStats,
} from '../api';
import { KpiCard } from '../components/KpiCard';
import { DEFAULT_PAGE_SIZE, Pager, paginateClientSide } from '../components/Pager';
import { LegendRow, TooltipCard, formatDayMonth } from '../components/OverviewCharts';
import { CHROME, METRIC_COLOR, formatCount } from '../chartTheme';

/**
 * "Bảng điều khiển vận hành" (operations dashboard mockup) — Phase 3.
 * Deliberately narrower than the reference mockup: live per-kiosk online/
 * offline status and a real-time incident feed both have NO backing data
 * today (`Device` has no heartbeat/online concept the way `Printer` does,
 * and there is no incident-listing endpoint over `device_events`) — per
 * product decision, both are omitted rather than faked. Everything shown
 * below reads real fields from `GET /v1/dashboard/kpis`,
 * `GET /v1/dashboard/campaigns/active`, and `GET /v1/review/stats`. See
 * `api.ts`'s own doc comments on why `dashboardKpis` is scoped to "your own
 * activity today", not a campaign-wide total.
 */
export function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [campaigns, setCampaigns] = useState<DashboardActiveCampaign[] | null>(null);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [campaignsPageSize, setCampaignsPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setError(null);
    Promise.allSettled([getDashboardKpis(), getDashboardActiveCampaigns(), getReviewStats()]).then(
      ([kpisRes, campaignsRes, reviewRes]) => {
        if (kpisRes.status === 'fulfilled') setKpis(kpisRes.value);
        if (campaignsRes.status === 'fulfilled') setCampaigns(campaignsRes.value);
        if (reviewRes.status === 'fulfilled') setReviewStats(reviewRes.value);
        const firstError = [kpisRes, campaignsRes, reviewRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (firstError) setError(firstError.reason instanceof ApiError ? firstError.reason.message : String(firstError.reason));
      }
    );
  }, []);

  // Campaign-wide totals — summed across every active campaign, since
  // `dashboardKpis` itself is scoped to the signed-in admin's own activity
  // only (see this file's own doc comment). This is the real substitute for
  // the mockup's headline numbers.
  const totals = (campaigns ?? []).reduce(
    (acc, c) => ({
      captured: acc.captured + c.captured,
      pendingReview: acc.pendingReview + c.pendingReview,
      overdue: acc.overdue + c.overdue,
      inProgressNow: acc.inProgressNow + c.inProgressNow,
    }),
    { captured: 0, pendingReview: 0, overdue: 0, inProgressNow: 0 }
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Bảng điều khiển vận hành</h1>
      <p className="text-sm text-gray-500 mb-6">
        Chỉ hiển thị số liệu có thật từ hệ thống — không có trạng thái kiosk online/offline thời gian thực và feed sự
        cố (chưa có dữ liệu backend cho 2 mục này).
      </p>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-6">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="SV đã chụp (đợt đang chạy)" value={totals.captured} color={METRIC_COLOR.captured} />
        <KpiCard label="Đang chờ duyệt" value={totals.pendingReview} color={METRIC_COLOR.pendingReview} />
        <KpiCard label="Quá hạn xử lý" value={totals.overdue} color={METRIC_COLOR.overdue} />
        <KpiCard label="Đã in" value={kpis?.printed ?? 0} color={METRIC_COLOR.printed} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Các đợt chụp đang hoạt động</h2>
          <p className="text-xs text-gray-500 mb-4">
            "Đang có phiên" = có phiên chụp bắt đầu trong 15 phút gần nhất — tín hiệu hoạt động gần nhất hiện có,
            không phải trạng thái online/offline thật của kiosk.
          </p>
          {campaigns === null && !error && <p className="text-sm text-gray-500">Đang tải...</p>}
          {campaigns?.length === 0 && <p className="text-sm text-gray-500">Không có đợt chụp nào đang hoạt động.</p>}
          {campaigns && campaigns.length > 0 && (() => {
            const { pageItems, meta } = paginateClientSide(campaigns, campaignsPage, campaignsPageSize);
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

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Hoạt động của bạn theo ngày</h2>
        <p className="text-xs text-gray-500 mb-4">
          Chỉ tính số ảnh do chính bạn (tài khoản đang đăng nhập) chụp — API chưa hỗ trợ tổng theo toàn hệ thống theo
          từng ngày.
        </p>
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

/** Same 100%-stacked-bar pattern `StatsPanel.tsx`'s `EmbeddingOutcomeBreakdown`/`UploadOutcomeBreakdown` already use — kept identical rather than introducing a pie/donut chart type this app doesn't otherwise use. */
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
