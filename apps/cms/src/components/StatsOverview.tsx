import { useEffect, useState } from 'react';
import { AllCampaignsStats, ApiError, getAllCampaignsStats } from '../api';
import { StatTile } from './StatsPanel';

/**
 * Landing page for the CMS — one grand total across every campaign (backed
 * by `GET /v1/campaigns/stats/summary`), plus the per-campaign breakdown it
 * was summed from. `StatsPanel` on a campaign's own detail page stays as
 * the place to see just that one campaign's numbers; this page is for
 * comparing across all of them without clicking into each one.
 */
export function StatsOverview({ onOpenCampaign }: { onOpenCampaign: (id: string) => void }) {
  const [stats, setStats] = useState<AllCampaignsStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllCampaignsStats()
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Tổng quan</h1>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {!stats && !error && <p className="text-gray-500">Đang tải...</p>}

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatTile label="Campaign" value={stats.totalCampaigns} />
            <StatTile label="Thiết bị" value={stats.totalDevices} />
            <StatTile label="Session hoàn tất" value={stats.totalSessionsCompleted} />
            <StatTile label="Upload thành công" value={stats.totalUploadSuccess} />
            <StatTile label="Upload thất bại" value={stats.totalUploadFailed} />
            <StatTile label="Lần chụp lại" value={stats.totalRetakes} />
            <StatTile label="CB Help can thiệp" value={stats.totalCbHelpInterventions} />
            <StatTile label="Phiên chụp" value={stats.totalSessions} />
            {/* totalPhotos is a breakdown object ({ total, ready, pending, failed }), not a bare
                count - see CampaignPhotoStats in api.ts - so the tile shows its .total. */}
            <StatTile label="Ảnh" value={stats.totalPhotos.total} />
          </div>

          <h2 className="font-semibold text-gray-900 mb-3">Theo từng campaign</h2>

          {stats.campaigns.length === 0 && <p className="text-gray-500 text-sm">Chưa có campaign nào.</p>}

          {stats.campaigns.length > 0 && (
            <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
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
                      <button
                        onClick={() => onOpenCampaign(c.campaignId)}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Xem →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
