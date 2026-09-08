import { useEffect, useState } from 'react';

interface CapturedStudentItem {
  sessionId: string;
  subjectCode: string;
  subjectName: string | null;
  className: string | null;
  major: string | null;
  academicYear: string | null;
  workflowId: string | null;
  photoCount: number;
  approvedAt: number;
  createdAt: number;
}

interface PhotoRef {
  jobId: string;
  sessionId: string;
  kind: string;
  fsFileId: string | null;
  fsStatus: string | null;
  localAvailable: boolean;
}

type PhotoViewState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Kiosk-local "sinh viên đã chụp" screen (2026-09-08 "student gallery"
 * feature) — mounted instead of `<App />` when this window is opened with
 * the `#recent-students` hash (see `main.tsx` and `recentStudentsWindow.ts`'s
 * own doc comment for the `Ctrl/Cmd+Shift+S` shortcut that opens it). Not
 * for the student being photographed — for a teacher/operator standing at
 * the kiosk.
 *
 * Everything here is local: `faceAPI.listRecentStudents`/`listStudentSessions`/
 * `searchStudents` read `CapturedStudentRepository`'s SQLite table directly
 * (no network), and photo viewing reuses the exact same
 * `faceAPI.listSessionPhotos`/`viewPhoto` pipeline the review screen already
 * uses — no new photo-serving code, this screen just calls it for a session
 * chosen from history instead of the one just captured.
 */
export default function RecentStudentsScreen() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<CapturedStudentItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CapturedStudentItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [photoViews, setPhotoViews] = useState<Record<string, PhotoViewState>>({});

  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    setListError(null);
    const load = query.trim()
      ? faceAPI?.searchStudents?.(query.trim())
      : faceAPI?.listRecentStudents?.(50);
    load
      ?.then((rows: CapturedStudentItem[]) => setStudents(rows ?? []))
      .catch((err: Error) => setListError(err.message));
  }, [query]);

  useEffect(() => {
    if (!selectedCode) {
      setSessions([]);
      return;
    }
    const faceAPI = (window as any).faceAPI;
    faceAPI?.listStudentSessions?.(selectedCode).then((rows: CapturedStudentItem[]) => setSessions(rows ?? []));
    setSelectedSessionId(null);
  }, [selectedCode]);

  useEffect(() => {
    if (!selectedSessionId) {
      setPhotos([]);
      setPhotoViews({});
      return;
    }
    let cancelled = false;
    const faceAPI = (window as any).faceAPI;
    setPhotos([]);
    setPhotoViews({});
    faceAPI
      ?.listSessionPhotos?.(selectedSessionId)
      .then(async (rows: PhotoRef[]) => {
        if (cancelled) return;
        setPhotos(rows);
        setPhotoViews(Object.fromEntries(rows.map((p) => [p.jobId, { status: 'loading' as const }])));
        for (const photo of rows) {
          faceAPI
            .viewPhoto({ jobId: photo.jobId, viewerId: 'kiosk-operator' })
            .then((result: { ok: boolean; url?: string; error?: string }) => {
              if (cancelled) return;
              setPhotoViews((prev) => ({
                ...prev,
                [photo.jobId]: result.ok && result.url
                  ? { status: 'ready', url: result.url }
                  : { status: 'error', message: result.error ?? 'Không tải được ảnh' },
              }));
            });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      <div className="w-72 shrink-0 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h1 className="font-bold text-lg">Sinh viên đã chụp</h1>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo mã hoặc tên..."
            className="mt-3 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {listError && <p className="p-3 text-sm text-rose-400">{listError}</p>}
          {students.length === 0 && !listError && (
            <p className="p-3 text-sm text-slate-500">Chưa có sinh viên nào được chụp trên máy này.</p>
          )}
          {students.map((s) => (
            <button
              key={s.subjectCode}
              onClick={() => setSelectedCode(s.subjectCode)}
              className={`w-full text-left px-4 py-2.5 border-b border-slate-900 hover:bg-slate-900 ${
                selectedCode === s.subjectCode ? 'bg-slate-900' : ''
              }`}
            >
              <div className="text-sm font-medium">{s.subjectCode}</div>
              <div className="text-xs text-slate-400">
                {s.subjectName ?? '—'} · {formatDateTime(s.approvedAt)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="w-72 shrink-0 border-r border-slate-800 overflow-y-auto">
        {!selectedCode && <p className="p-4 text-sm text-slate-500">Chọn 1 sinh viên để xem các lần chụp.</p>}
        {selectedCode && sessions.length === 0 && (
          <p className="p-4 text-sm text-slate-500">Không có phiên nào trên máy này.</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.sessionId}
            onClick={() => setSelectedSessionId(s.sessionId)}
            className={`w-full text-left px-4 py-3 border-b border-slate-900 hover:bg-slate-900 ${
              selectedSessionId === s.sessionId ? 'bg-slate-900' : ''
            }`}
          >
            <div className="text-sm">{formatDateTime(s.approvedAt)}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {s.className ?? '—'} · {s.photoCount} ảnh
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selectedSessionId && <p className="text-sm text-slate-500">Chọn 1 phiên để xem ảnh.</p>}
        {selectedSessionId && photos.length === 0 && <p className="text-sm text-slate-500">Đang tải...</p>}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {photos.map((photo) => {
            const view = photoViews[photo.jobId];
            return (
              <div key={photo.jobId} className="rounded-xl overflow-hidden bg-slate-900 border border-slate-800">
                <div className="aspect-[3/4] bg-slate-800 flex items-center justify-center text-xs text-slate-500">
                  {(!view || view.status === 'loading') && <span>Đang tải...</span>}
                  {view?.status === 'error' && <span>{view.message}</span>}
                  {view?.status === 'ready' && (
                    <img src={view.url} alt={photo.kind} className="w-full h-full object-cover" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
