import { useEffect, useState } from 'react';
import { ApiError, CampaignStats, getCampaignStats } from '../api';

function StatTile({ label, value }: { label: string; value: number }) {
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

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <h2 className="font-semibold text-gray-900 mb-4">Thống kê</h2>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {!stats && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatTile label="Thiết bị" value={stats.deviceCount} />
          <StatTile label="Session hoàn tất" value={stats.sessionsCompleted} />
          <StatTile label="Upload thành công" value={stats.uploadSuccess} />
          <StatTile label="Upload thất bại" value={stats.uploadFailed} />
          <StatTile label="Lần chụp lại" value={stats.retakes} />
          <StatTile label="CB Help can thiệp" value={stats.cbHelpInterventions} />
        </div>
      )}
    </div>
  );
}
