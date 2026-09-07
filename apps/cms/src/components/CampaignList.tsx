import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AllCampaignsStats, ApiError, Campaign, getAllCampaignsStats, listCampaigns } from '../api';
import { StatTile } from './StatsPanel';
import { CampaignDangerActions } from './CampaignDangerActions';
import { PURPOSE_LABEL, formatExpiry, isExpired, isExpiringSoon } from '../campaignFormat';

/**
 * Campaign list (`/campaigns`) — Part 3 of the 2026-09-07 redesign (product
 * request: campaign list + campaign-level stats + create button + per-row
 * view/edit/extend/delete). The inline toggle-shown create form is gone;
 * "+ Tạo campaign" now links to its own page (`/campaigns/new`, Part 4).
 */
export function CampaignList() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  // Only used for its totalDevices figure in the stats strip below — the
  // rest of AllCampaignsStats (sessions/uploads/etc.) is Overview's job, not
  // this page's; a failure here just means that one tile doesn't render.
  const [allStats, setAllStats] = useState<AllCampaignsStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    listCampaigns()
      .then(setCampaigns)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    getAllCampaignsStats()
      .then(setAllStats)
      .catch(() => {
        /* non-fatal to this page - the "Tổng thiết bị" tile just won't show */
      });
  };

  useEffect(reload, []);

  const updateRow = (updated: Campaign) => {
    setCampaigns((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? prev);
  };
  const removeRow = (id: string) => {
    setCampaigns((prev) => prev?.filter((c) => c.id !== id) ?? prev);
  };

  // Expiry-window counts are computed client-side from the campaigns list
  // already fetched above (per-campaign `expiresAt`) — no new backend
  // endpoint needed for this, distinct from Overview's cross-campaign usage
  // stats (sessions/uploads/etc.) which stay on GET /v1/campaigns/stats/summary.
  const summary = campaigns && {
    total: campaigns.length,
    expired: campaigns.filter((c) => isExpired(c)).length,
    expiringSoon: campaigns.filter((c) => isExpiringSoon(c)).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <Link
          to="/campaigns/new"
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Tạo campaign
        </Link>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatTile label="Tổng campaign" value={summary.total} />
          <StatTile label="Đang hoạt động" value={summary.total - summary.expired} />
          <StatTile label="Đã hết hạn" value={summary.expired} />
          <StatTile label="Sắp hết hạn (7 ngày)" value={summary.expiringSoon} />
          {allStats && <StatTile label="Tổng thiết bị" value={allStats.totalDevices} />}
        </div>
      )}

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {campaigns === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {campaigns && campaigns.length === 0 && <p className="text-gray-500">Chưa có campaign nào.</p>}

      {campaigns && campaigns.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Mục đích</th>
              <th className="py-2.5 px-4">Hạn dùng</th>
              <th className="py-2.5 px-4">Consent v.</th>
              <th className="py-2.5 px-4">Chế độ chụp</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 font-medium text-gray-900">{c.name}</td>
                <td className="py-2.5 px-4 text-gray-500">{PURPOSE_LABEL[c.purpose]}</td>
                <td className="py-2.5 px-4 text-gray-500">
                  <span className="whitespace-nowrap">{formatExpiry(c)}</span>
                  {isExpired(c) && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                      Hết hạn
                    </span>
                  )}
                  {!isExpired(c) && isExpiringSoon(c) && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                      Sắp hết hạn
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-500">{c.consentVersion}</td>
                <td className="py-2.5 px-4">
                  <div className="flex flex-wrap gap-1">
                    {c.simultaneousCapture && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
                        Đồng thời
                      </span>
                    )}
                    {c.recordVideo && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                        Quay video
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <Link to={`/campaigns/${c.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
                      Xem
                    </Link>
                    <Link to={`/campaigns/${c.id}/edit`} className="text-gray-600 hover:text-gray-800 font-medium">
                      Sửa
                    </Link>
                    <CampaignDangerActions campaign={c} compact onExtended={updateRow} onDeleted={() => removeRow(c.id)} />
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
