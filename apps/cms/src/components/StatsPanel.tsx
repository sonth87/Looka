import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import {
  ApiError,
  breakdownCount,
  CampaignBreakdownCount,
  CampaignDayStats,
  CampaignMember,
  CampaignStats,
  getCampaignStats,
  listCampaignMembers,
  updateCampaignMember,
} from '../api';
import { CHROME, formatCount, METRIC_COLOR, NEUTRAL_ACCENT } from '../chartTheme';
import { formatDayMonth, LegendRow, PhotoStatusBreakdown, TooltipCard, UploadOutcomeBreakdown } from './OverviewCharts';

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

/**
 * Compact "Cán bộ chờ duyệt" card — 2026-09-08, replaces the dedicated
 * "Cán bộ chụp" tab (removed the same day per product feedback: "không
 * cần phân công", the approval concept itself is still needed, just not a
 * whole tab for it). Lives at the top of the "Thống kê" tab rather than
 * "Sinh viên", since campaign membership is about which STAFF can operate
 * this campaign, an entirely different thing from which STUDENTS have been
 * photographed — mixing the two under "Sinh viên" would be confusing.
 * Deliberately minimal: only the pending queue with inline approve/reject,
 * no full history table (that's what the removed tab had room for; this
 * card does not) — collapses to nothing when there is nothing pending.
 */
function PendingApprovalsCard({ campaignId }: { campaignId: string }) {
  const [members, setMembers] = useState<CampaignMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const reload = () => {
    listCampaignMembers(campaignId, 'PENDING')
      .then(setMembers)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [campaignId]);

  const pending = members ?? [];

  const act = async (member: CampaignMember, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Ghi chú từ chối (không bắt buộc):') ?? undefined : undefined;
    setBusyUserId(member.userId);
    setError(null);
    try {
      await updateCampaignMember(campaignId, member.userId, action, note);
      setMembers((prev) => prev?.filter((m) => m.userId !== member.userId) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  };

  // Nothing to show and nothing wrong — a quiet no-op, not an empty-state message.
  if (!error && members !== null && pending.length === 0) return null;

  return (
    <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50/40 mb-5">
      <h2 className="font-semibold text-gray-900 mb-3">Cán bộ chờ duyệt {members && `(${pending.length})`}</h2>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-2">{error}</div>}
      {members === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {pending.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b border-amber-200">
              <th className="py-2 pr-3">Tên</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Gửi lúc</th>
              <th className="py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            {pending.map((m) => (
              <tr key={m.userId} className="border-b border-amber-100 last:border-0">
                <td className="py-2 pr-3 text-gray-900 font-medium">{m.displayName ?? '—'}</td>
                <td className="py-2 pr-3 text-gray-500">{m.email}</td>
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{formatTime(m.requestedAt)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <button
                      onClick={() => void act(m, 'approve')}
                      disabled={busyUserId === m.userId}
                      className="text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-40"
                    >
                      Duyệt
                    </button>
                    <button
                      onClick={() => void act(m, 'reject')}
                      disabled={busyUserId === m.userId}
                      className="text-red-600 hover:text-red-800 font-medium disabled:opacity-40"
                    >
                      Từ chối
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value.toLocaleString('vi-VN')}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

/**
 * "Tự động"/"Thủ công" breakdown (C1/C2.3, ui-redesign-plan.md §3) — `GESTURE`
 * (held hand gesture) and `SHUTTER` (on-screen button) are combined into one
 * "Thủ công" segment per `campaign-config-sso-card-photo-discussion.md`
 * §3.7.1's Q15 decision. 2026-09-15: upgraded from a pair of tiles (with the
 * gesture/shutter split as a native `title` tooltip) to the same 100%-stacked
 * horizontal bar `PhotoStatusBreakdown`/`UploadOutcomeBreakdown` use in
 * `OverviewCharts.tsx` — AUTO/MANUAL is a part-to-whole pair, not a lone
 * number, and a real chart tooltip now carries the gesture/shutter split as a
 * nested detail instead of relying on a plain-HTML hover title. Wears its own
 * two `chartTheme.ts` categorical slots (`triggerAuto`/`triggerManual`)
 * rather than the reserved `STATUS` colors — neither trigger source is
 * "better", so this isn't a good/bad status pair.
 */
function TriggerBreakdownChart({ byTrigger }: { byTrigger: CampaignBreakdownCount[] }) {
  // `byTrigger` is a sparse array of grouped rows (see `breakdownCount`'s own
  // doc comment) — a trigger source with zero photos has no row at all, so
  // every lookup must default to 0 rather than assume the key exists.
  const auto = breakdownCount(byTrigger, 'AUTO');
  const gesture = breakdownCount(byTrigger, 'GESTURE');
  const shutter = breakdownCount(byTrigger, 'SHUTTER');
  const manual = gesture + shutter;
  const total = auto + manual;
  const data = [{ name: 'Trigger', auto, manual }];

  function renderTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%');
    return (
      <TooltipCard
        title="Nguồn chụp"
        rows={[
          { color: METRIC_COLOR.triggerAuto, shape: 'rect', label: 'Tự động', value: `${formatCount(auto)} (${pct(auto)})` },
          { color: METRIC_COLOR.triggerManual, shape: 'rect', label: 'Thủ công', value: `${formatCount(manual)} (${pct(manual)})` },
          { color: '#d1d5db', shape: 'rect', label: '↳ Cử chỉ tay', value: formatCount(gesture) },
          { color: '#d1d5db', shape: 'rect', label: '↳ Bấm nút', value: formatCount(shutter) },
        ]}
      />
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tabular-nums text-gray-900">{formatCount(total)}</span>
        <span className="text-sm text-gray-500">lượt chụp</span>
      </div>

      <div style={{ width: '100%', height: 36 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, total || 1]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="auto" stackId="a" fill={METRIC_COLOR.triggerAuto} stroke="#fff" strokeWidth={2} radius={[4, 0, 0, 4]} barSize={24} />
            <Bar dataKey="manual" stackId="a" fill={METRIC_COLOR.triggerManual} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-sm">
        <li><LegendRow color={METRIC_COLOR.triggerAuto} shape="rect" label="Tự động" value={formatCount(auto)} /></li>
        <li><LegendRow color={METRIC_COLOR.triggerManual} shape="rect" label="Thủ công" value={formatCount(manual)} /></li>
      </ul>
    </div>
  );
}

/**
 * Embedding-registration outcome (2026-09-15, field request: "cần lưu log
 * thông báo này lại để thông báo lên cms với các lỗi khi chụp ảnh" — a real
 * session had every CENTER-step enrollment rejected, e.g. "ảnh có N khuôn
 * mặt", and that was only visible in the kiosk's own local log). Same
 * 100%-stacked-bar shape as `UploadOutcomeBreakdown` — this IS a genuine
 * good/bad pair (unlike `TriggerBreakdownChart`'s auto/manual), so it wears
 * `STATUS`-derived colors (`METRIC_COLOR.embeddingEnrolled`/`embeddingFailed`)
 * the same way upload success/failure already does. Renders nothing when
 * both counts are zero (a campaign that never enrolled anything has no
 * "outcome" to show — distinct from "0/0 rejected", which would misread as
 * a 0% failure rate).
 */
function EmbeddingOutcomeBreakdown({ enrolled, failed }: { enrolled: number; failed: number }) {
  const total = enrolled + failed;
  const data = [{ name: 'Embedding', enrolled, failed }];

  function renderTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%');
    return (
      <TooltipCard
        title="Kết quả đăng ký embedding"
        rows={[
          { color: METRIC_COLOR.embeddingEnrolled, shape: 'rect', label: 'Thành công', value: `${formatCount(enrolled)} (${pct(enrolled)})` },
          { color: METRIC_COLOR.embeddingFailed, shape: 'rect', label: 'Thất bại', value: `${formatCount(failed)} (${pct(failed)})` },
        ]}
      />
    );
  }

  if (total === 0) return <p className="text-sm text-gray-500">Chưa có lượt đăng ký nào</p>;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tabular-nums text-gray-900">{formatCount(total)}</span>
        <span className="text-sm text-gray-500">lượt đăng ký</span>
      </div>

      <div style={{ width: '100%', height: 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, total || 1]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={renderTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
            <Bar dataKey="enrolled" stackId="a" fill={METRIC_COLOR.embeddingEnrolled} stroke="#fff" strokeWidth={2} radius={[4, 0, 0, 4]} barSize={28} />
            <Bar dataKey="failed" stackId="a" fill={METRIC_COLOR.embeddingFailed} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-sm">
        <li><LegendRow color={METRIC_COLOR.embeddingEnrolled} shape="rect" label="Thành công" value={formatCount(enrolled)} /></li>
        <li><LegendRow color={METRIC_COLOR.embeddingFailed} shape="rect" label="Thất bại" value={formatCount(failed)} /></li>
      </ul>
    </div>
  );
}

/**
 * "30 ngày gần nhất" trend — replaces the original hand-rolled `<div>` bar
 * chart (raw inline `height` percentages). Sessions and photos run at
 * different scales (each session yields several photos), so per the
 * dataviz skill's "two measures of different scale -> two charts, each on
 * its own axis" rule (the same rule `OverviewCharts.tsx` already follows to
 * split `QualityTrendChart` from `SessionsTrendChart`) they get two small
 * bar panels rather than one dual-axis chart, sharing the same day-formatted
 * x-axis for a side-by-side read. `sessions` wears the same violet
 * `METRIC_COLOR.sessions` as the "Phiên chụp" tile; `photos` is a
 * meta/root-entity total (not one of the tracked ready/pending/failed
 * series), so it wears `NEUTRAL_ACCENT` rather than a categorical hue.
 */
function DailyTrendChart({ byDay }: { byDay: CampaignDayStats[] }) {
  function renderSessionsTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0 || typeof label !== 'string') return null;
    return (
      <TooltipCard
        title={formatDayMonth(label)}
        rows={[{ color: METRIC_COLOR.sessions, shape: 'rect', label: 'Phiên chụp', value: formatCount(Number(payload[0]?.value ?? 0)) }]}
      />
    );
  }

  function renderPhotosTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0 || typeof label !== 'string') return null;
    return (
      <TooltipCard
        title={formatDayMonth(label)}
        rows={[{ color: NEUTRAL_ACCENT, shape: 'rect', label: 'Ảnh', value: formatCount(Number(payload[0]?.value ?? 0)) }]}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <div className="text-xs font-medium text-gray-500 mb-1.5">Phiên chụp theo ngày</div>
        <div style={{ width: '100%', height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={byDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHROME.gridline} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayMonth}
                tick={{ fontSize: 10, fill: CHROME.axisText }}
                axisLine={{ stroke: CHROME.gridline }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: CHROME.axisText }} axisLine={false} tickLine={false} width={28} />
              <Tooltip content={renderSessionsTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
              <Bar dataKey="sessions" name="Phiên chụp" fill={METRIC_COLOR.sessions} radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500 mb-1.5">Ảnh theo ngày</div>
        <div style={{ width: '100%', height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={byDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHROME.gridline} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayMonth}
                tick={{ fontSize: 10, fill: CHROME.axisText }}
                axisLine={{ stroke: CHROME.gridline }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: CHROME.axisText }} axisLine={false} tickLine={false} width={28} />
              <Tooltip content={renderPhotosTooltip} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
              <Bar dataKey="photos" name="Ảnh" fill={NEUTRAL_ACCENT} radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/**
 * The "tối thiểu cần có" snapshot from
 * docs/plans/multi-camera-device-management-discussion.md §3.4 — event
 * counts pushed by kiosks via `POST /v1/devices/events`. Everything reads
 * zero until at least one kiosk is actually wired up to push; that's a
 * correct empty state, not a bug, so it's shown plainly rather than hidden.
 */
export function StatsPanel({ campaignId }: { campaignId: string }) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCampaignStats(campaignId)
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId]);

  return (
    <div>
      <PendingApprovalsCard campaignId={campaignId} />

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Thống kê</h2>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {!stats && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {stats && (
        <>
          {/*
            Single independent scalars with no natural "parts of a whole"
            grouping stay as compact tiles — a chart adds no value for a lone
            number. Upload success/failed and Ảnh READY/đang chờ/lỗi moved
            below into real part-to-whole charts (2026-09-15); see the
            `PhotoStatusBreakdown`/`UploadOutcomeBreakdown` panels.
          */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatTile label="Thiết bị" value={stats.deviceCount} />
            <StatTile label="Phiên chụp" value={stats.sessions} />
            <StatTile label="Session hoàn tất" value={stats.sessionsCompleted} />
            <StatTile label="Lần chụp lại" value={stats.retakes} />
            <StatTile label="CB Help can thiệp" value={stats.cbHelpInterventions} />
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Trạng thái ảnh</h3>
              <PhotoStatusBreakdown photos={stats.photos} />
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Kết quả upload</h3>
              <UploadOutcomeBreakdown uploadSuccess={stats.uploadSuccess} uploadFailed={stats.uploadFailed} />
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Kết quả đăng ký embedding</h3>
              <EmbeddingOutcomeBreakdown enrolled={stats.embeddingEnrolled} failed={stats.embeddingFailed} />
            </div>
          </div>

          {stats.byTrigger && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Nguồn chụp</h3>
              <TriggerBreakdownChart byTrigger={stats.byTrigger} />
            </div>
          )}

          {stats.byDevice.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Theo thiết bị</h3>
              <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                    <th className="py-2 px-3">Thiết bị</th>
                    <th className="py-2 px-3">Phiên</th>
                    <th className="py-2 px-3">Ảnh READY</th>
                    <th className="py-2 px-3">Ảnh lỗi</th>
                    <th className="py-2 px-3">Lần chụp cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byDevice.map((d) => (
                    <tr key={d.deviceId} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 px-3 text-gray-900">{d.deviceName}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{d.sessions}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{d.photosReady}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{d.photosFailed}</td>
                      <td className="py-2 px-3 text-gray-500">
                        {d.lastCaptureAt ? new Date(d.lastCaptureAt).toLocaleString('vi-VN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.byOperator.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Theo cán bộ chụp</h3>
              <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                    <th className="py-2 px-3">Cán bộ chụp</th>
                    <th className="py-2 px-3">Phiên</th>
                    <th className="py-2 px-3">Ảnh READY</th>
                    <th className="py-2 px-3">Ảnh lỗi</th>
                    <th className="py-2 px-3">Lần chụp cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byOperator.map((o) => (
                    <tr key={o.operatorUserId ?? 'unknown'} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 px-3 text-gray-900">{o.operatorName}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{o.sessions}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{o.photosReady}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{o.photosFailed}</td>
                      <td className="py-2 px-3 text-gray-500">
                        {o.lastCaptureAt ? new Date(o.lastCaptureAt).toLocaleString('vi-VN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.byDay.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-2">30 ngày gần nhất</h3>
              <DailyTrendChart byDay={stats.byDay} />
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
