import { useEffect, useState } from 'react';
import {
  ApiError,
  Campaign,
  ListStudentsParams,
  Paginated,
  StudentDetail,
  StudentListItem,
  getStudent,
  listCampaigns,
  listStudents,
} from '../api';
import { SessionDetailDrawer } from './SessionDetailDrawer';

const PAGE_SIZE = 20;

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Global "Sinh viên đã chụp" page (2026-09-08) — one row per `subjectCode`,
 * across every campaign unless filtered, distinct from `SessionsPanel`'s
 * per-campaign, one-row-per-session list. Clicking a student opens
 * `StudentDetailDrawer` below; clicking one of their sessions there opens
 * the existing, unmodified `SessionDetailDrawer` — this page never renders
 * a photo/video grid itself.
 */
export function StudentsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<Paginated<StudentListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStudentCode, setOpenStudentCode] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch(() => {
        /* the campaign filter just stays empty — not fatal to the page */
      });
  }, []);

  useEffect(() => {
    const params: ListStudentsParams = { page, limit: PAGE_SIZE };
    if (campaignId) params.campaignId = campaignId;
    if (q.trim()) params.q = q.trim();

    setError(null);
    listStudents(params)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId, q, page]);

  const students = result?.items ?? [];
  const meta = result?.meta;
  const isEmpty = result !== null && students.length === 0;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Sinh viên đã chụp</h1>

      <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo mã hoặc tên sinh viên..."
            className="flex-1 min-w-[220px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          />

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
        </div>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        {result === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

        {isEmpty && !error && <p className="text-sm text-gray-500">Chưa có sinh viên nào được chụp.</p>}

        {students.length > 0 && (
          <>
            <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-4">Mã SV</th>
                  <th className="py-2.5 px-4">Tên</th>
                  <th className="py-2.5 px-4">Số phiên</th>
                  <th className="py-2.5 px-4">Tổng ảnh</th>
                  <th className="py-2.5 px-4">Campaign</th>
                  <th className="py-2.5 px-4">Chụp gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr
                    key={s.subjectCode}
                    onClick={() => setOpenStudentCode(s.subjectCode)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-4 text-gray-900 font-medium">{s.subjectCode}</td>
                    <td className="py-2.5 px-4 text-gray-500">{s.subjectName ?? '—'}</td>
                    <td className="py-2.5 px-4 text-gray-900 tabular-nums">{s.sessionCount}</td>
                    <td className="py-2.5 px-4 text-gray-900 tabular-nums">{s.totalPhotos}</td>
                    <td className="py-2.5 px-4 text-gray-500">{s.campaignIds.length}</td>
                    <td className="py-2.5 px-4 text-gray-500">{formatDateTime(s.lastCapturedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

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
                  Trang {meta.currentPage}/{meta.totalPages}
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

      {openStudentCode && (
        <StudentDetailDrawer subjectCode={openStudentCode} onClose={() => setOpenStudentCode(null)} />
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<StudentSessionSummarySource, string> = { KIOSK: 'Kiosk', WEB: 'Web' };
type StudentSessionSummarySource = 'KIOSK' | 'WEB';

/**
 * Right-side drawer listing one student's sessions across every campaign —
 * mirrors `SessionDetailDrawer`'s drawer chrome, but shows session summaries
 * rather than a photo grid: clicking a session opens `SessionDetailDrawer`
 * itself (unmodified) for the actual photos/videos.
 */
function StudentDetailDrawer({ subjectCode, onClose }: { subjectCode: string; onClose: () => void }) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getStudent(subjectCode)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [subjectCode]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !openSessionId) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, openSessionId]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">{subjectCode}</h2>
            {detail?.subjectName && <p className="text-sm text-gray-500 mt-0.5">{detail.subjectName}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1 shrink-0">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-3">
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          {!detail && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

          {detail?.sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpenSessionId(s.id)}
              className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-gray-50 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {formatDateTime(s.capturedAt ?? s.completedAt)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {s.deviceName ?? '—'} · {SOURCE_LABEL[s.source]} · {s.photos.length} ảnh
                  {s.videos.length > 0 ? ` · ${s.videos.length} video` : ''}
                </div>
              </div>
              <span className="text-gray-400 shrink-0">→</span>
            </button>
          ))}
        </div>
      </div>

      {openSessionId && <SessionDetailDrawer sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />}
    </div>
  );
}
