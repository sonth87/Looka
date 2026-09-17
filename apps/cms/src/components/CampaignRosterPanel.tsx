import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  CampaignSubject,
  CampaignSubjectImport,
  CampaignSubjectStatus,
  Paginated,
  deleteCampaignRosterImport,
  downloadRosterImportTemplate,
  importCampaignRoster,
  listCampaignRosterImports,
  listCampaignSubjects,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';

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
const IMPORT_STATUS_LABEL: Record<CampaignSubjectImport['status'], string> = {
  PROCESSING: 'Đang xử lý',
  DONE: 'Hoàn tất',
  FAILED: 'Lỗi',
};

/**
 * "Danh sách roster" tab (plan item 15, 2026-09-17) — import Excel roster
 * for `eligibility.mode = ROSTER`/`ROSTER_AND_API` (the other half of the
 * same ask is the "call API" path, configured inline per-workflow in
 * `WorkflowConfigEditor.tsx`'s `EligibilityApiFields`). The
 * backend (`CampaignSubjectController`) has existed since P3 (2026-09-14);
 * this is its first CMS screen. Deliberately separate from the "Sinh viên"
 * tab (`CampaignStudentsPanel`, captured sessions) — this is the EXPECTED
 * roster a session gets checked against, not who has actually shown up.
 */
export function CampaignRosterPanel({ campaignId }: { campaignId: string }) {
  const [imports, setImports] = useState<CampaignSubjectImport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [statusFilter, setStatusFilter] = useState<CampaignSubjectStatus | ''>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [subjectsResult, setSubjectsResult] = useState<Paginated<CampaignSubject> | null>(null);

  const reloadImports = () => {
    listCampaignRosterImports(campaignId)
      .then(setImports)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };
  useEffect(reloadImports, [campaignId]);

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

  async function handleFileSelected(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      await importCampaignRoster(campaignId, file);
      reloadImports();
      setPage(1);
      // Re-trigger the subjects list too.
      listCampaignSubjects(campaignId, { page: 1, limit: pageSize }).then(setSubjectsResult).catch(() => {});
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const subjects = subjectsResult?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Import roster từ Excel</h3>
          <button type="button" onClick={() => void downloadTemplate()} className="text-xs text-blue-600 hover:text-blue-800 underline">
            Tải file mẫu
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
            }}
            className="text-sm text-gray-700"
          />
          {uploading && <span className="text-xs text-gray-500">Đang tải lên...</span>}
        </div>
        {uploadError && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{uploadError}</div>}

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
    </div>
  );
}
