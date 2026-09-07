import { useEffect, useState } from 'react';
import { ApiError, CampaignStats, getCampaignStats } from '../api';

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-2xl font-bold tabular-nums text-gray-900">{value.toLocaleString('vi-VN')}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
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
  );
}
