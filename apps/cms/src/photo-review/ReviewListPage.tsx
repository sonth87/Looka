import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import {
  ApiError,
  Campaign,
  ListReviewSetsParams,
  Paginated,
  PhotoKind,
  ReviewSetListItem,
  ReviewSetStatus,
  listCampaigns,
  listPhotoKinds,
  listReviewSets,
} from '../api';
import { REVIEW_STATUS_BADGE_CLASS, REVIEW_STATUS_LABEL, isReviewSetLocked } from './reviewFormat';

const PAGE_SIZE = 24;
const STATUS_OPTIONS: ReviewSetStatus[] = ['PENDING_AUTO', 'AUTO_FAILED', 'READY', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

/**
 * "Duyệt ảnh" list page (C5, new — cms-photo-review-plan.md §5.1). Route
 * `/review`, its own top-level nav item (see `Layout.tsx`), calling
 * `GET /v1/review/sets` with the filters §7's endpoint table lists. A card
 * grid (the mockup's default view) rather than the table `ReviewSetStatus`
 * count strip the mockup also shows — that strip needs dataset-wide counts
 * the list endpoint's contract doesn't specify, so this page only shows the
 * current page's pagination info instead of fabricating totals.
 */
export function ReviewListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [kinds, setKinds] = useState<PhotoKind[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [kindId, setKindId] = useState('');
  const [status, setStatus] = useState<ReviewSetStatus | ''>('');
  const [hasAi, setHasAi] = useState(false);
  const [hasUpload, setHasUpload] = useState(false);
  const [missingCard, setMissingCard] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<Paginated<ReviewSetListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch(() => {
        /* campaign filter just stays empty — not fatal */
      });
    listPhotoKinds()
      .then(setKinds)
      .catch(() => {
        /* "Loại" filter just stays hidden — GET /v1/photo-kinds may not exist yet */
      });
  }, []);

  useEffect(() => {
    const params: ListReviewSetsParams = { page, limit: PAGE_SIZE };
    if (campaignId) params.campaignId = campaignId;
    if (kindId) params.kindId = kindId;
    if (status) params.status = status;
    if (hasAi) params.hasAi = true;
    if (hasUpload) params.hasUpload = true;
    if (missingCard) params.missingCard = true;
    if (q.trim()) params.q = q.trim();

    setError(null);
    listReviewSets(params)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, kindId, status, hasAi, hasUpload, missingCard, q, page]);

  const sets = result?.items ?? [];
  const meta = result?.meta;
  const isEmpty = result !== null && sets.length === 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Duyệt ảnh</h1>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <select
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Tất cả campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {kinds.length > 0 && (
            <select
              value={kindId}
              onChange={(e) => {
                setKindId(e.target.value);
                setPage(1);
              }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="">Tất cả loại ảnh</option>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.labelVi}
                </option>
              ))}
            </select>
          )}

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ReviewSetStatus | '');
              setPage(1);
            }}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Tất cả trạng thái</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {REVIEW_STATUS_LABEL[s]}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo mã hoặc tên..."
            className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hasAi}
              onChange={(e) => {
                setHasAi(e.target.checked);
                setPage(1);
              }}
              className="rounded border-gray-300"
            />
            Chỉ hồ sơ có sửa AI
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hasUpload}
              onChange={(e) => {
                setHasUpload(e.target.checked);
                setPage(1);
              }}
              className="rounded border-gray-300"
            />
            Chỉ ảnh tải lên
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={missingCard}
              onChange={(e) => {
                setMissingCard(e.target.checked);
                setPage(1);
              }}
              className="rounded border-gray-300"
            />
            Thiếu ảnh 4x6
          </label>
        </div>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {result === null && !error && <p className="text-gray-500">Đang tải...</p>}
      {isEmpty && !error && <p className="text-gray-500">Không có hồ sơ nào khớp bộ lọc.</p>}

      {sets.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sets.map((s) => (
              <ReviewSetCard key={s.id} set={s} />
            ))}
          </div>

          {meta && meta.totalPages !== undefined && meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.currentPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Trước
              </button>
              <span>
                Trang {meta.currentPage}/{meta.totalPages} · {meta.totalItems ?? sets.length} hồ sơ
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={meta.currentPage >= meta.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewSetCard({ set }: { set: ReviewSetListItem }) {
  const locked = isReviewSetLocked(set);

  return (
    <Link
      to={`/review/${set.id}`}
      className="block rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-[3/4] bg-gray-50 flex items-center justify-center relative">
        {locked ? (
          <div className="flex flex-col items-center gap-1.5 text-center px-3 text-gray-400">
            <Lock className="w-6 h-6" />
            <span className="text-xs">
              {set.status === 'AUTO_FAILED' ? (set.failReason ?? 'Tạo ảnh 4x6 lỗi') : 'Đang tạo ảnh 4x6…'}
            </span>
          </div>
        ) : set.currentCardViewUrl ? (
          <img src={set.currentCardViewUrl} alt={set.subjectCode} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-gray-400">Chưa có ảnh thẻ</span>
        )}
      </div>
      <div className="p-2.5 space-y-1">
        <div className="text-sm font-semibold text-gray-900 truncate">{set.subjectCode}</div>
        <div className="text-xs text-gray-500 truncate">{set.subjectName ?? '—'}</div>
        <div className="flex flex-wrap items-center gap-1">
          <span className={`px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${REVIEW_STATUS_BADGE_CLASS[set.status]}`}>
            {REVIEW_STATUS_LABEL[set.status]}
          </span>
          {set.hasAi && (
            <span className="px-1.5 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-medium">
              AI
            </span>
          )}
          {set.hasUpload && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-medium">
              Upload
            </span>
          )}
          {set.hasFallback && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium">
              Fallback
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
