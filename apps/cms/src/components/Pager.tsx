import type { PaginationMeta } from '../api';

/** Page size every paginated CMS list page starts at — keeps a single list fetch bounded, never "everything at once". */
export const DEFAULT_PAGE_SIZE = 10;

/** Choices offered by the page-size selector every `Pager` below renders. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 99];

/**
 * Client-side pagination for an endpoint with no server-side `page`/`limit`
 * of its own (e.g. `GET /v1/campaigns/stats/summary`'s per-campaign
 * breakdown, `GET /v1/dashboard/campaigns/active` — both single aggregate
 * responses, not list endpoints) — slices an already-fetched array and
 * synthesizes the same `PaginationMeta` shape a real paginated endpoint
 * would return, so `Pager` below works identically either way.
 */
export function paginateClientSide<T>(
  items: T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { pageItems: T[]; meta: PaginationMeta } {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return {
    pageItems,
    meta: { itemCount: pageItems.length, totalItems, itemsPerPage: pageSize, totalPages, currentPage },
  };
}

/**
 * Builds the compact page-number sequence a pager renders: always the first
 * and last page, the current page and its immediate neighbors, and a single
 * `'ellipsis'` marker wherever a gap opens up — the standard "1 2 3 ... 8 9
 * 10" shape, never a raw list of every page number for a large result set.
 */
function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | 'ellipsis')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis');
    result.push(sorted[i]);
  }
  return result;
}

/**
 * Numbered pager with an optional page-size selector (2026-09-16 — replaced
 * the earlier Trước/Sau-only version per product feedback, then gained the
 * selector per a follow-up request to let the admin choose 10/20/50/99 rows
 * per page) used across every list page this pass added pagination to
 * (`CampaignList`, `AnglePresetsPage`, `CaptureConfigurationsPage`,
 * `PhotoKindsPage`, `IdentificationMethodsPage`, `WorkflowsPage`,
 * `StatsOverview`, `DashboardPage`, `PrintPage`).
 *
 * The page-size selector (and item count) render whenever `meta` exists;
 * the Trước/1/2/…/Sau page-number row only renders once there's more than
 * one page — a caller can still shrink `pageSize` even when everything fits
 * on page 1 today.
 */
export function Pager({
  meta,
  itemLabel,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  meta: PaginationMeta | null | undefined;
  /** Vietnamese noun for the count, e.g. "campaign", "góc chụp" — appended after the total count. */
  itemLabel: string;
  onPageChange: (page: number) => void;
  /** Current rows-per-page — pass together with `onPageSizeChange` to show the selector. */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  if (!meta) return null;

  const showPageButtons = meta.totalPages !== undefined && meta.totalPages > 1;
  const pages = showPageButtons ? pageNumbers(meta.currentPage, meta.totalPages!) : [];

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-gray-500 pt-4">
      <div className="flex items-center gap-3">
        <span>
          {meta.totalItems ?? meta.itemCount} {itemLabel}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span>Hiển thị</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-700"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>/ trang</span>
          </label>
        )}
      </div>

      {showPageButtons && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, meta.currentPage - 1))}
            disabled={meta.currentPage <= 1}
            aria-label="Trang trước"
            className="w-8 h-8 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
          >
            ‹
          </button>
          {pages.map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-gray-400">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                disabled={p === meta.currentPage}
                aria-current={p === meta.currentPage ? 'page' : undefined}
                className={`w-8 h-8 rounded-lg border text-sm font-medium ${
                  p === meta.currentPage
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPageChange(Math.min(meta.totalPages!, meta.currentPage + 1))}
            disabled={meta.currentPage >= meta.totalPages!}
            aria-label="Trang sau"
            className="w-8 h-8 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
