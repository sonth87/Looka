import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  CampaignStudentRosterRow,
  clearCampaignStudentRoster,
  deleteCampaignStudentRosterRow,
  importCampaignStudentRoster,
  listCampaignStudentRoster,
  Paginated,
  RosterImportResult,
  updateCampaignStudentRosterRow,
} from '../api';

const PAGE_SIZE = 20;

/**
 * "Sinh viên dự kiến" tab (2026-09-09, CCCD-scan capture-identification
 * feature) — a campaign's expected-student roster, populated by CSV bulk
 * import. Deliberately its own tab, separate from "Sinh viên"
 * (`CampaignStudentsPanel`, the capture *log*): the two answer different
 * questions ("who is expected to show up" vs. "who has already been
 * photographed") and conflating them would make neither screen make sense
 * — an import here doesn't create any capture history, and a capture-log
 * row's presence doesn't imply the person was ever on this roster.
 *
 * CSV upload (file or pasted text, both go through the same
 * `importCampaignStudentRoster` call) is the only bulk-populate path, per
 * the task's own "don't over-build this" scope call — there is no
 * dedicated "add one row" form; a bad import row is fixed in place (inline
 * edit) or removed, not re-added from scratch.
 */
export function CampaignRosterPanel({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<CampaignStudentRosterRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<RosterImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UpdateDraft>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    const params = { page, limit: PAGE_SIZE, ...(q.trim() ? { q: q.trim() } : {}) };
    setError(null);
    setResult(null);
    listCampaignStudentRoster(campaignId, params)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, q, page, reloadTick]);

  const reload = () => setReloadTick((n) => n + 1);

  async function runImport(file: File) {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await importCampaignStudentRoster(campaignId, file);
      setImportResult(res);
      setPasteText('');
      setShowPaste(false);
      setPage(1);
      reload();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file
    if (file) void runImport(file);
  }

  function handleImportPastedText() {
    if (!pasteText.trim()) return;
    const file = new File([pasteText], 'roster.csv', { type: 'text/csv' });
    void runImport(file);
  }

  async function handleClearAll() {
    if (!window.confirm('Xoá toàn bộ danh sách sinh viên dự kiến của campaign này? Không thể hoàn tác.')) return;
    try {
      await clearCampaignStudentRoster(campaignId);
      setPage(1);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleDeleteRow(rowId: string) {
    if (!window.confirm('Xoá dòng này khỏi danh sách dự kiến?')) return;
    try {
      await deleteCampaignStudentRosterRow(campaignId, rowId);
      reload();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : String(err));
    }
  }

  function startEdit(row: CampaignStudentRosterRow) {
    setEditingId(row.id);
    setRowError(null);
    setEditDraft({
      studentCode: row.studentCode,
      studentName: row.studentName,
      citizenId: row.citizenId,
      className: row.className ?? '',
      major: row.major ?? '',
      academicYear: row.academicYear ?? '',
    });
  }

  async function saveEdit(rowId: string) {
    setSavingEdit(true);
    setRowError(null);
    try {
      await updateCampaignStudentRosterRow(campaignId, rowId, editDraft);
      setEditingId(null);
      reload();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  const rows = result?.items ?? [];
  const meta = result?.meta;
  const isEmpty = result !== null && rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-900">Nhập danh sách từ CSV</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Cột: mã SV, họ tên, số CCCD (bắt buộc); lớp, ngành, năm học (tuỳ chọn). Có dòng tiêu đề, thứ tự cột tuỳ ý.
              Nhập lại (cùng số CCCD) sẽ cập nhật dòng cũ thay vì tạo trùng.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChosen}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {importing ? 'Đang nhập...' : 'Tải lên file CSV'}
            </button>
            <button
              onClick={() => setShowPaste((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              Dán văn bản CSV
            </button>
          </div>
        </div>

        {showPaste && (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'maSV,hoTen,soCCCD,lop,nganh,namHoc\nSV001,Nguyen Van A,001199001234,CNTT01,CNTT,2025-2026'}
              rows={6}
              className="w-full font-mono text-xs bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
            <button
              onClick={handleImportPastedText}
              disabled={importing || !pasteText.trim()}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {importing ? 'Đang nhập...' : 'Nhập văn bản này'}
            </button>
          </div>
        )}

        {importError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{importError}</div>
        )}

        {importResult && (
          <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm space-y-1">
            <p>
              Đã nhập {importResult.imported}/{importResult.totalRows} dòng.
              {importResult.errors.length > 0 ? ` ${importResult.errors.length} dòng bị bỏ qua:` : ''}
            </p>
            {importResult.errors.length > 0 && (
              <ul className="list-disc list-inside space-y-0.5">
                {importResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Dòng {e.line}: {e.reason}
                  </li>
                ))}
                {importResult.errors.length > 20 && <li>...và {importResult.errors.length - 20} dòng khác</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo mã SV, tên, hoặc số CCCD..."
            className="w-full max-w-sm bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          />
          {rows.length > 0 && (
            <button onClick={handleClearAll} className="text-sm text-red-600 hover:text-red-700 font-medium shrink-0">
              Xoá toàn bộ danh sách
            </button>
          )}
        </div>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        {rowError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{rowError}</div>}

        {result === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

        {isEmpty && !error && (
          <p className="text-sm text-gray-500">Chưa có sinh viên dự kiến nào — nhập danh sách từ CSV ở trên.</p>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                    <th className="py-2.5 px-4">Mã SV</th>
                    <th className="py-2.5 px-4">Tên</th>
                    <th className="py-2.5 px-4">Số CCCD</th>
                    <th className="py-2.5 px-4">Lớp</th>
                    <th className="py-2.5 px-4">Ngành</th>
                    <th className="py-2.5 px-4">Năm học</th>
                    <th className="py-2.5 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    editingId === row.id ? (
                      <tr key={row.id} className="border-b border-gray-100 last:border-0 bg-blue-50/40">
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.studentCode ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, studentCode: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.studentName ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, studentName: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.citizenId ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, citizenId: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.className ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, className: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.major ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, major: v }))} />
                        </td>
                        <td className="py-1.5 px-2">
                          <EditCell value={editDraft.academicYear ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, academicYear: v }))} />
                        </td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => void saveEdit(row.id)}
                            disabled={savingEdit}
                            className="text-blue-600 hover:text-blue-700 font-medium mr-3 disabled:opacity-50"
                          >
                            Lưu
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-700">
                            Huỷ
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="py-2.5 px-4 text-gray-900 font-medium">{row.studentCode}</td>
                        <td className="py-2.5 px-4 text-gray-700">{row.studentName}</td>
                        <td className="py-2.5 px-4 text-gray-700 font-mono">{row.citizenId}</td>
                        <td className="py-2.5 px-4 text-gray-500">{row.className ?? '—'}</td>
                        <td className="py-2.5 px-4 text-gray-500">{row.major ?? '—'}</td>
                        <td className="py-2.5 px-4 text-gray-500">{row.academicYear ?? '—'}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(row)} className="text-blue-600 hover:text-blue-700 font-medium mr-3">
                            Sửa
                          </button>
                          <button onClick={() => void handleDeleteRow(row.id)} className="text-red-600 hover:text-red-700 font-medium">
                            Xoá
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages !== undefined && meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-gray-500 pt-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.currentPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Trước
                </button>
                <span>
                  Trang {meta.currentPage}/{meta.totalPages} ({meta.totalItems ?? rows.length} sinh viên)
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
    </div>
  );
}

interface UpdateDraft {
  studentCode?: string;
  studentName?: string;
  citizenId?: string;
  className?: string;
  major?: string;
  academicYear?: string;
}

function EditCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-[6rem] bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
    />
  );
}
