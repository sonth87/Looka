import { useEffect, useState } from 'react';
import {
  ApiError,
  CampaignMember,
  CampaignStats,
  CaptureTriggerBreakdown,
  getCampaignStats,
  listCampaignMembers,
  updateCampaignMember,
} from '../api';

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
 * "Tự động"/"Thủ công" tiles (C1/C2.3, ui-redesign-plan.md §3) — `GESTURE`
 * (held hand gesture) and `SHUTTER` (on-screen button) are combined into one
 * "Thủ công" tile per `campaign-config-sso-card-photo-discussion.md` §3.7.1's
 * Q15 decision, with the split shown as a native-title tooltip on hover
 * rather than a second row of tiles — this app has no chart tooltip
 * component to reuse outside `recharts` (see `OverviewCharts.tsx`), and a
 * plain `title` attribute is the same lightweight pattern `DevicesPanel`
 * already uses for its own hover explanations.
 */
function TriggerBreakdownTiles({ byTrigger }: { byTrigger: CaptureTriggerBreakdown }) {
  const manual = byTrigger.GESTURE + byTrigger.SHUTTER;
  return (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatTile label="Tự động" value={byTrigger.AUTO} />
      <div
        className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
        title={`Cử chỉ tay: ${byTrigger.GESTURE.toLocaleString('vi-VN')} · Bấm nút: ${byTrigger.SHUTTER.toLocaleString('vi-VN')}`}
      >
        <div className="text-2xl font-bold tabular-nums text-gray-900">{manual.toLocaleString('vi-VN')}</div>
        <div className="text-xs text-gray-500 mt-0.5">Thủ công</div>
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

  // Tallest day in the 30-day window, so each bar's height is relative to it;
  // floored at 1 to avoid a divide-by-zero when every day so far is empty.
  const maxDaySessions = stats ? Math.max(1, ...stats.byDay.map((d) => d.sessions)) : 1;

  return (
    <div>
      <PendingApprovalsCard campaignId={campaignId} />

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Thống kê</h2>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {!stats && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatTile label="Thiết bị" value={stats.deviceCount} />
            <StatTile label="Session hoàn tất" value={stats.sessionsCompleted} />
            <StatTile label="Upload thành công" value={stats.uploadSuccess} />
            <StatTile label="Upload thất bại" value={stats.uploadFailed} />
            <StatTile label="Lần chụp lại" value={stats.retakes} />
            <StatTile label="CB Help can thiệp" value={stats.cbHelpInterventions} />
            <StatTile label="Phiên chụp" value={stats.sessions} />
            <StatTile label="Ảnh READY" value={stats.photos.ready} />
            <StatTile label="Ảnh đang chờ" value={stats.photos.pending} />
            <StatTile label="Ảnh lỗi" value={stats.photos.failed} />
          </div>

          {stats.byTrigger && <TriggerBreakdownTiles byTrigger={stats.byTrigger} />}

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

          {stats.byDay.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-2">30 ngày gần nhất</h3>
              <div className="flex items-end gap-0.5 h-20">
                {stats.byDay.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.sessions} phiên, ${d.photos} ảnh`}
                    className="flex-1 bg-blue-400 hover:bg-blue-500 rounded-t transition-colors"
                    style={{ height: `${Math.max((d.sessions / maxDaySessions) * 100, 4)}%` }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
