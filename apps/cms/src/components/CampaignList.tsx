import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AllCampaignsStats,
  ApiError,
  Campaign,
  EffectiveStatus,
  Paginated,
  WorkflowDetail,
  getAllCampaignsStats,
  listCampaigns,
  listCampaignsPaginated,
  listWorkflows,
} from '../api';
import { StatTile } from './StatsPanel';
import { CampaignDangerActions } from './CampaignDangerActions';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';
import { EFFECTIVE_STATUS_LABEL, PURPOSE_LABEL, formatExpiry, isExpired, isExpiringSoon } from '../campaignFormat';

/**
 * Campaign list (`/campaigns`) — Part 3 of the 2026-09-07 redesign (product
 * request: campaign list + campaign-level stats + create button + per-row
 * view/edit/extend/delete). The inline toggle-shown create form is gone;
 * "+ Tạo campaign" now links to its own page (`/campaigns/new`, Part 4).
 *
 * 2026-09-16: the table itself switched to real backend pagination+filters
 * (`listCampaignsPaginated`, `GET /v1/campaigns?page&limit&status&q`) so a
 * single fetch never pulls more than `DEFAULT_PAGE_SIZE` rows — the summary
 * tiles below still read the legacy unfiltered `listCampaigns()` full array
 * separately, since "Tổng campaign"/"Đã hết hạn"/"Sắp hết hạn" are meant to
 * stay global counts, unaffected by whatever status/search filter the table
 * is currently narrowed to.
 */
export function CampaignList() {
  const [status, setStatus] = useState<EffectiveStatus | ''>('');
  const [q, setQ] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<Campaign> | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowDetail[]>([]);

  const [allCampaigns, setAllCampaigns] = useState<Campaign[] | null>(null);
  // Only used for its totalDevices figure in the stats strip below — the
  // rest of AllCampaignsStats (sessions/uploads/etc.) is Overview's job, not
  // this page's; a failure here just means that one tile doesn't render.
  const [allStats, setAllStats] = useState<AllCampaignsStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaignsPaginated({
      page,
      limit: pageSize,
      status: status || undefined,
      q: q.trim() || undefined,
      workflowId: workflowId || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [page, pageSize, status, q, workflowId, from, to]);

  // Plan item 12: workflow filter dropdown — only ACTIVE workflows can be
  // pinned to a campaign in the first place (`CampaignForm.tsx`'s own
  // `selectableWorkflows`), so filtering by anything else would never match.
  useEffect(() => {
    listWorkflows({ status: 'ACTIVE', limit: 100 })
      .then((r) => setWorkflows(r.items))
      .catch(() => {});
  }, []);

  const reloadSummary = () => {
    listCampaigns()
      .then(setAllCampaigns)
      .catch(() => {
        /* non-fatal — the summary tiles just won't show */
      });
    getAllCampaignsStats()
      .then(setAllStats)
      .catch(() => {
        /* non-fatal to this page - the "Tổng thiết bị" tile just won't show */
      });
  };

  useEffect(reloadSummary, []);

  const campaigns = result?.items ?? null;

  const updateRow = (updated: Campaign) => {
    setResult((prev) => (prev ? { ...prev, items: prev.items.map((c) => (c.id === updated.id ? updated : c)) } : prev));
  };
  const removeRow = (id: string) => {
    setResult((prev) => (prev ? { ...prev, items: prev.items.filter((c) => c.id !== id) } : prev));
    reloadSummary();
  };

  // Expiry-window counts are computed client-side from the FULL (unfiltered)
  // campaign list fetched above (per-campaign `expiresAt`) — no new backend
  // endpoint needed for this, distinct from Overview's cross-campaign usage
  // stats (sessions/uploads/etc.) which stay on GET /v1/campaigns/stats/summary.
  const summary = allCampaigns && {
    total: allCampaigns.length,
    expired: allCampaigns.filter((c) => isExpired(c)).length,
    expiringSoon: allCampaigns.filter((c) => isExpiringSoon(c)).length,
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

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as EffectiveStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(EFFECTIVE_STATUS_LABEL) as EffectiveStatus[]).map((s) => (
            <option key={s} value={s}>
              {EFFECTIVE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo tên hoặc mã campaign..."
          className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={workflowId}
          onChange={(e) => {
            setWorkflowId(e.target.value);
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả workflow</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          Từ
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          Đến
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
      </div>

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

      <Pager
        meta={result?.meta}
        itemLabel="campaign"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
