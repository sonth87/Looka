import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  Campaign,
  Paginated,
  PrintItem,
  PrintItemStatus,
  listCampaigns,
  listCampaignSubjectDistinctValues,
  listPrintItems,
  previewPrintItemUrl,
} from '../api';
import { Pager } from '../components/Pager';
import {
  PRINT_ITEM_BUCKET_BADGE_CLASS,
  PRINT_ITEM_BUCKET_LABEL,
  PRINT_ITEM_STATUS_LABEL,
  printItemStatusBucket,
} from './printFormat';

/**
 * "In thẻ theo campaign" (`/print/by-campaign`) — plan item 8, 2026-09-17.
 * `PrintPage.tsx`/`PrintBatchDetailPage.tsx` only ever list items scoped to
 * a BATCH; this screen picks a campaign directly (no `batchId`) so an
 * operator can see every student's photo + print status for that campaign
 * regardless of which batch (if any) it's attached to. Reuses
 * `GET /v1/print/items?campaignId=` — already supported filter, just never
 * called without a `batchId` from any CMS screen before this.
 *
 * Default sort is `statusPriority` (§5 Q2, chốt 2026-09-17): "chưa in" rows
 * surface first, so a campaign that's already mostly printed still shows
 * its few remaining un-printed rows right at the top instead of buried
 * behind a wall of "đã in" rows sorted by creation time.
 *
 * Thumbnails reuse the existing per-item render/preview endpoint
 * (`GET /v1/print/items/:id/preview`, same one `CardPreviewModal` already
 * uses) rather than a new dedicated thumbnail field — no DAO/DB change
 * needed. That endpoint always returns SOME png (falls back to a live
 * render if nothing's been rendered yet), so a "chưa in" row's thumbnail
 * may take a moment or fail if the photo itself is still missing
 * (`missingFields` would include `cardPhoto`) — `PrintItemThumbnail` shows
 * a plain placeholder box on that failure rather than a broken image.
 */
export function CampaignPrintStatusPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [statusFilter, setStatusFilter] = useState<PrintItemStatus | ''>('');
  const [classNameFilter, setClassNameFilter] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [classNameOptions, setClassNameOptions] = useState<string[]>([]);
  const [facultyOptions, setFacultyOptions] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [result, setResult] = useState<Paginated<PrintItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  // Plan §G.2.d, 2026-09-17: lớp/khoa dropdowns are populated from this
  // campaign's real roster (`GET /v1/campaigns/:id/subjects/distinct-values`)
  // rather than free text — reset to empty when no campaign is selected yet.
  useEffect(() => {
    if (!campaignId) {
      setClassNameOptions([]);
      setFacultyOptions([]);
      return;
    }
    listCampaignSubjectDistinctValues(campaignId, 'className')
      .then((r) => setClassNameOptions(r.items))
      .catch(() => setClassNameOptions([]));
    listCampaignSubjectDistinctValues(campaignId, 'faculty')
      .then((r) => setFacultyOptions(r.items))
      .catch(() => setFacultyOptions([]));
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) {
      setResult(null);
      return;
    }
    setError(null);
    listPrintItems({
      campaignId,
      status: statusFilter || undefined,
      className: classNameFilter || undefined,
      faculty: facultyFilter || undefined,
      q: q.trim() || undefined,
      sort: 'statusPriority',
      page,
      limit: pageSize,
    })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, statusFilter, classNameFilter, facultyFilter, q, page, pageSize]);

  const items = result?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">In thẻ theo campaign</h1>
        <Link to="/print" className="text-sm text-blue-600 hover:text-blue-800 underline">
          ← Về danh sách đợt in
        </Link>
      </div>

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm mb-4 flex flex-wrap gap-3">
        <select
          value={campaignId}
          onChange={(e) => {
            setCampaignId(e.target.value);
            setClassNameFilter('');
            setFacultyFilter('');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">— Chọn campaign —</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã SV hoặc tên..."
          className="flex-1 min-w-[180px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={classNameFilter}
          onChange={(e) => {
            setClassNameFilter(e.target.value);
            setPage(1);
          }}
          disabled={!campaignId}
          className="w-32 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
        >
          <option value="">Tất cả lớp</option>
          {classNameOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={facultyFilter}
          onChange={(e) => {
            setFacultyFilter(e.target.value);
            setPage(1);
          }}
          disabled={!campaignId}
          className="w-32 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
        >
          <option value="">Tất cả khoa</option>
          {facultyOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as PrintItemStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(PRINT_ITEM_STATUS_LABEL) as PrintItemStatus[]).map((s) => (
            <option key={s} value={s}>
              {PRINT_ITEM_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {!campaignId && <p className="text-gray-500">Chọn 1 campaign để xem danh sách.</p>}

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {campaignId && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {items.map((item) => {
            const bucket = printItemStatusBucket(item.status);
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <PrintItemThumbnail itemId={item.id} />
                <div className="p-2.5">
                  <div className="text-sm font-medium text-gray-900 truncate">{item.subjectCode}</div>
                  <div className="text-xs text-gray-500 truncate mb-1">{item.fullName ?? '—'}</div>
                  <div className="text-xs text-gray-400 truncate mb-1.5">Người chụp: {item.operatorName ?? '—'}</div>
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${PRINT_ITEM_BUCKET_BADGE_CLASS[bucket]}`}>
                    {PRINT_ITEM_BUCKET_LABEL[bucket]}
                  </span>
                </div>
              </div>
            );
          })}
          {items.length === 0 && !error && (
            <p className="col-span-full text-center text-gray-400 py-8">Chưa có thẻ nào khớp bộ lọc trong campaign này.</p>
          )}
        </div>
      )}

      {campaignId && (
        <Pager
          meta={result?.meta}
          itemLabel="thẻ"
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[12, 24, 48]}
        />
      )}
    </div>
  );
}

/** Lazily fetches its own thumbnail (auth'd fetch → blob URL, same pattern `CardPreviewModal` uses) — plain gray placeholder if the item has no renderable photo yet, rather than a broken `<img>`. */
function PrintItemThumbnail({ itemId }: { itemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    setFailed(false);
    previewPrintItemUrl(itemId, 'front')
      .then((u) => {
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId]);

  if (failed) {
    return <div className="w-full aspect-[2/3] bg-gray-100 flex items-center justify-center text-gray-400 text-xs">Chưa có ảnh</div>;
  }
  if (!url) {
    return <div className="w-full aspect-[2/3] bg-gray-50 animate-pulse" aria-hidden="true" />;
  }
  return <img src={url} alt="" className="w-full aspect-[2/3] object-cover" />;
}
