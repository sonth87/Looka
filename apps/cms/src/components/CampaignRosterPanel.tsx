import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  CampaignSubject,
  CampaignSubjectImport,
  CampaignSubjectStatus,
  EligibilityConfig,
  Paginated,
  deleteCampaignRosterImport,
  downloadRosterImportTemplate,
  importCampaignRoster,
  listCampaignRosterImports,
  listCampaignSubjects,
  requestCampaignSubjectPull,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';
import { ModalShell } from './CampaignDangerActions';

const STATUS_LABEL: Record<CampaignSubjectStatus, string> = {
  VALID: 'Hợp lệ',
  ERROR: 'Lỗi',
  DUPLICATE: 'Trùng',
};
const STATUS_BADGE_CLASS: Record<CampaignSubjectStatus, string> = {
  VALID: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  ERROR: 'bg-red-50 border-red-200 text-red-700',
  DUPLICATE: 'bg-amber-50 border-amber-200 text-amber-700',
};
/**
 * Covers BOTH the `EXCEL` upload lifecycle (`PROCESSING`/`DONE`/`FAILED`)
 * AND an `EXTERNAL_API` pull's own (`PENDING_FETCH`/`FETCHING`/
 * `IMPORTING`/`DONE`/`FAILED`) — `listCampaignRosterImports` returns both
 * kinds in one list (see `apps/cms/src/api.ts`'s `CampaignSubjectImport`
 * doc comment). Before this, an API-pull row rendered a blank status cell
 * here (`IMPORT_STATUS_LABEL[status]` was `undefined` for any of the 3
 * pull-only statuses) — a real gap found while auditing the roster-pull
 * queue (2026-09-28), since this table was built before the API-pull
 * feature existed and never revisited for it.
 */
const IMPORT_STATUS_LABEL: Record<CampaignSubjectImport['status'], string> = {
  PROCESSING: 'Đang xử lý',
  PENDING_FETCH: 'Chờ gọi API',
  FETCHING: 'Đang gọi API',
  IMPORTING: 'Đang ghi dữ liệu',
  DONE: 'Hoàn tất',
  FAILED: 'Lỗi',
};
/** Non-terminal statuses for EITHER import lifecycle — an import still at one of these hasn't finished yet. */
const IMPORT_IN_PROGRESS_STATUSES = new Set<CampaignSubjectImport['status']>([
  'PROCESSING',
  'PENDING_FETCH',
  'FETCHING',
  'IMPORTING',
]);
/** How often to re-poll `listCampaignRosterImports` while a triggered pull is still in progress — roughly matches `CampaignSubjectPullWriteWorker`'s own 2s drain tick. */
const PULL_POLL_INTERVAL_MS = 2_000;
/** Stop auto-polling after this long even if still running — a genuinely stuck pull is `CampaignSubjectPullStuckJobRecoveryWorker`'s job (30 min), not this tab's; the operator can still see progress via a manual reload. */
const PULL_POLL_TIMEOUT_MS = 2 * 60_000;
/** Mirrors `CampaignSubjectService.requestPull`'s own 5-minute "already running" guard — used to show an approximate remaining wait on its 409. */
const PULL_RECENCY_GUARD_MS = 5 * 60_000;

/**
 * "Danh sách roster" tab (plan item 15, 2026-09-17) — import Excel roster
 * for `eligibilityConfig.mode = ROSTER`/`ROSTER_AND_API` (the other half of
 * the same ask is the "call API" path, configured inline per-campaign in
 * `EligibilityConfigEditor.tsx`'s `EligibilityApiFields`, wired into
 * `CampaignForm.tsx` — moved there from the workflow screen 2026-09-18, see
 * `apps/cms/src/api.ts`'s `EligibilityConfig` section header comment). The
 * backend (`CampaignSubjectController`) has existed since P3 (2026-09-14);
 * this is its first CMS screen. Deliberately separate from the "Sinh viên"
 * tab (`CampaignStudentsPanel`, captured sessions) — this is the EXPECTED
 * roster a session gets checked against, not who has actually shown up.
 *
 * `eligibilityMode` (2026-09-28) — the campaign's OWN `eligibilityConfig.mode`
 * (`CampaignDetail.tsx` already has the full `Campaign` loaded, so it's
 * passed down rather than re-fetched here). The "Kéo lại dữ liệu" re-pull
 * button only makes sense for `EXTERNAL_API`/`ROSTER_AND_API` — a plain
 * `ROSTER`/`NONE` campaign has no API configured to pull from.
 */
export function CampaignRosterPanel({
  campaignId,
  eligibilityMode,
}: {
  campaignId: string;
  eligibilityMode: EligibilityConfig['mode'];
}) {
  const [imports, setImports] = useState<CampaignSubjectImport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [statusFilter, setStatusFilter] = useState<CampaignSubjectStatus | ''>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [subjectsResult, setSubjectsResult] = useState<Paginated<CampaignSubject> | null>(null);

  const canPullFromApi = eligibilityMode === 'EXTERNAL_API' || eligibilityMode === 'ROSTER_AND_API';
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullRetryAfterSeconds, setPullRetryAfterSeconds] = useState<number | null>(null);
  const [confirmForcePull, setConfirmForcePull] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadImports = () => {
    listCampaignRosterImports(campaignId)
      .then(setImports)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };
  useEffect(reloadImports, [campaignId]);

  function stopPullPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }
  // Stop any in-flight poll when the tab is torn down or switches campaign —
  // otherwise it would keep hitting the API for a campaign no longer shown.
  useEffect(() => stopPullPolling, [campaignId]);

  /** Re-fetches the import list every `PULL_POLL_INTERVAL_MS` until `importId` itself reaches a terminal status, so the operator sees PENDING_FETCH → FETCHING → IMPORTING → DONE/FAILED without a manual reload — same end result `handleUpload` gets from one `reloadImports()` call, except a pull is asynchronous (the two-tier worker queue), so one refetch right after the POST would almost always still show PENDING_FETCH. */
  function pollPullUntilDone(importId: string) {
    stopPullPolling();
    const startedAt = Date.now();
    pollTimerRef.current = setInterval(() => {
      if (Date.now() - startedAt > PULL_POLL_TIMEOUT_MS) {
        stopPullPolling();
        return;
      }
      listCampaignRosterImports(campaignId)
        .then((fresh) => {
          setImports(fresh);
          const row = fresh.find((imp) => imp.id === importId);
          if (row && !IMPORT_IN_PROGRESS_STATUSES.has(row.status)) {
            stopPullPolling();
          }
        })
        .catch(() => {
          /* a transient poll failure isn't worth surfacing — the next tick (or a manual reload) recovers */
        });
    }, PULL_POLL_INTERVAL_MS);
  }

  const latestApiImport = (imports ?? []).find((imp) => imp.source === 'EXTERNAL_API') ?? null;
  const pullRunning = latestApiImport ? IMPORT_IN_PROGRESS_STATUSES.has(latestApiImport.status) : false;

  async function handleRequestPull(force: boolean) {
    setPulling(true);
    setPullError(null);
    setPullRetryAfterSeconds(null);
    try {
      const imp = await requestCampaignSubjectPull(campaignId, { force });
      setConfirmForcePull(false);
      reloadImports();
      pollPullUntilDone(imp.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      setPullError(message);
      if (err instanceof ApiError && err.status === 409) {
        setConfirmForcePull(true);
        if (latestApiImport) {
          const elapsedMs = Date.now() - new Date(latestApiImport.createdAt).getTime();
          setPullRetryAfterSeconds(Math.max(0, Math.ceil((PULL_RECENCY_GUARD_MS - elapsedMs) / 1000)));
        }
      } else {
        setConfirmForcePull(false);
      }
    } finally {
      setPulling(false);
    }
  }

  useEffect(() => {
    listCampaignSubjects(campaignId, { status: statusFilter || undefined, q: q.trim() || undefined, page, limit: pageSize })
      .then(setSubjectsResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, statusFilter, q, page, pageSize]);

  async function downloadTemplate() {
    try {
      const { blob, filename } = await downloadRosterImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      await importCampaignRoster(campaignId, selectedFile);
      reloadImports();
      setPage(1);
      // Re-trigger the subjects list too.
      listCampaignSubjects(campaignId, { page: 1, limit: pageSize }).then(setSubjectsResult).catch(() => {});
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowImportModal(false);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const subjects = subjectsResult?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Import roster từ Excel</h3>
          <div className="flex items-center gap-2">
            {canPullFromApi && (
              <button
                type="button"
                onClick={() => void handleRequestPull(false)}
                disabled={pulling || pullRunning}
                className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-semibold disabled:opacity-50"
              >
                {pullRunning ? 'Đang kéo dữ liệu...' : pulling ? 'Đang gửi yêu cầu...' : 'Kéo lại dữ liệu'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              Import roster
            </button>
          </div>
        </div>

        {pullError && (
          <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center justify-between gap-3">
            <span>
              {pullError}
              {confirmForcePull && pullRetryAfterSeconds !== null && pullRetryAfterSeconds > 0 && (
                <> (còn khoảng {pullRetryAfterSeconds}s)</>
              )}
            </span>
            {confirmForcePull && (
              <button
                type="button"
                onClick={() => void handleRequestPull(true)}
                disabled={pulling}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                Kéo ngay dù mới chạy gần đây?
              </button>
            )}
          </div>
        )}

        {imports && imports.length > 0 && (
          <div className="pt-2 border-t border-gray-100">
            <table className="w-full text-xs">
              <thead className="text-gray-500 uppercase">
                <tr>
                  <th className="text-left py-1.5">File</th>
                  <th className="text-left py-1.5">Trạng thái</th>
                  <th className="text-left py-1.5">Hợp lệ / Lỗi / Tổng</th>
                  <th className="text-left py-1.5">Lúc</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {imports.map((imp) => (
                  <tr key={imp.id}>
                    <td className="py-1.5 text-gray-900">{imp.fileName}</td>
                    <td className="py-1.5">
                      <span className={`px-1.5 py-0.5 rounded-full border ${imp.status === 'DONE' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : imp.status === 'FAILED' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                        {IMPORT_STATUS_LABEL[imp.status]}
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-500 tabular-nums">
                      {imp.validRows} / {imp.errorRows} / {imp.totalRows}
                    </td>
                    <td className="py-1.5 text-gray-500">{new Date(imp.createdAt).toLocaleString('vi-VN')}</td>
                    <td className="py-1.5 text-right space-x-2">
                      {imp.errorReportUrl && (
                        <a href={imp.errorReportUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                          Xem lỗi
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void deleteCampaignRosterImport(campaignId, imp.id)
                            .then(reloadImports)
                            .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
                        }
                        className="text-red-600 hover:text-red-800"
                      >
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Danh sách roster ({subjectsResult?.meta.totalItems ?? 0})</h3>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo mã SV hoặc tên..."
              className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as CampaignSubjectStatus | '');
                setPage(1);
              }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">Tất cả trạng thái</option>
              {(Object.keys(STATUS_LABEL) as CampaignSubjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 px-2">Mã SV</th>
                <th className="py-2 px-2">Họ tên</th>
                <th className="py-2 px-2">Lớp</th>
                <th className="py-2 px-2">Khoa</th>
                <th className="py-2 px-2">Trạng thái</th>
                <th className="py-2 px-2">Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 px-2 font-medium text-gray-900">{s.subjectCode}</td>
                  <td className="py-2 px-2 text-gray-700">{s.fullName}</td>
                  <td className="py-2 px-2 text-gray-500">{s.className ?? '—'}</td>
                  <td className="py-2 px-2 text-gray-500">{s.faculty ?? '—'}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_BADGE_CLASS[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-amber-600 text-xs">{s.errorMessage ?? '—'}</td>
                </tr>
              ))}
              {subjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    Chưa có dòng roster nào — import 1 file Excel ở trên để bắt đầu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pager
          meta={subjectsResult?.meta}
          itemLabel="dòng roster"
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {showImportModal && (
        <ModalShell
          title="Import roster từ Excel"
          onClose={() => {
            if (uploading) return;
            setShowImportModal(false);
            setSelectedFile(null);
            setUploadError(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Chọn file Excel (.xlsx) theo đúng mẫu.</span>
              <button type="button" onClick={() => void downloadTemplate()} className="text-xs text-blue-600 hover:text-blue-800 underline shrink-0">
                Tải file mẫu
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              disabled={uploading}
              onChange={(e) => {
                setSelectedFile(e.target.files?.[0] ?? null);
                setUploadError(null);
              }}
              className="w-full text-sm text-gray-700"
            />
            {uploadError && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{uploadError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedFile(null);
                  setUploadError(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={uploading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={!selectedFile || uploading}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {uploading ? 'Đang tải lên...' : 'Tải lên'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
