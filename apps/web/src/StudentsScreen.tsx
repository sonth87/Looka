import { useEffect, useState } from 'react';

/**
 * "Sinh viên đã chụp" (2026-09-08) — apps/web's own students gallery, a
 * second desktop icon alongside the capture app (see App.tsx's `appsConfig`).
 *
 * Deliberately has no shared client with the capture screen: `CaptureSink`
 * exists to abstract *where a capture goes*, not to be a general API client,
 * and this screen only ever reads `GET /v1/students`/`GET /v1/students/:code`
 * — reusing the same run-time-configured `window.LOOKA_API_BASE_URL`/
 * `window.LOOKA_API_KEY` globals `App.tsx` already sets up for
 * `HttpCaptureSink`, via the exact same header/envelope handling that class
 * uses (`x-api-key`, `{ statusCode, message, data }` envelope).
 *
 * Known, accepted exposure (2026-09-08 product decision): apps/web has no
 * login of any kind, so this screen — like the capture screen next to it —
 * is reachable by anyone who can load the page, with the same api-key every
 * caller shares. Every student's photos/videos are visible to that same
 * audience. See docs/ROADMAP.md's "student gallery" entry for the full
 * reasoning and why the CMS/kiosk equivalents of this feature do not carry
 * the same exposure.
 */

interface StudentListItem {
  subjectCode: string;
  subjectName?: string;
  sessionCount: number;
  totalPhotos: number;
  lastCapturedAt?: string;
}

interface StudentSessionPhoto {
  id: string;
  cameraRole?: string;
  mimeType: string;
  fsStatus?: string;
  viewUrl?: string;
}

interface StudentSessionVideo {
  id: string;
  cameraRole?: string;
  mimeType: string;
  durationMs?: number;
  fsStatus?: string;
  viewUrl?: string;
}

interface StudentSessionSummary {
  id: string;
  capturedAt?: string;
  completedAt?: string;
  deviceName?: string;
  photos: StudentSessionPhoto[];
  videos: StudentSessionVideo[];
}

interface StudentDetail {
  subjectCode: string;
  subjectName?: string;
  sessions: StudentSessionSummary[];
}

function baseUrl(): string {
  return (window as { LOOKA_API_BASE_URL?: string }).LOOKA_API_BASE_URL ?? 'http://localhost:3100';
}

function apiKey(): string | undefined {
  return (window as { LOOKA_API_KEY?: string }).LOOKA_API_KEY;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: apiKey() ? { 'x-api-key': apiKey()! } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }
  const envelope = (await res.json()) as { data: T };
  return envelope.data;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function StudentsScreen() {
  const [q, setQ] = useState('');
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (q.trim()) params.set('q', q.trim());
    setListError(null);
    apiGet<{ items: StudentListItem[] }>(`/v1/students?${params.toString()}`)
      .then((page) => setStudents(page.items))
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)));
  }, [q]);

  useEffect(() => {
    if (!selectedCode) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    apiGet<StudentDetail>(`/v1/students/${encodeURIComponent(selectedCode)}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCode]);

  return (
    <div className="w-full h-full flex bg-slate-950 text-slate-100 overflow-hidden">
      <div className="w-72 shrink-0 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo mã hoặc tên..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {listError && <p className="p-3 text-sm text-red-400">{listError}</p>}
          {students === null && !listError && <p className="p-3 text-sm text-slate-500">Đang tải...</p>}
          {students?.length === 0 && <p className="p-3 text-sm text-slate-500">Chưa có sinh viên nào.</p>}
          {students?.map((s) => (
            <button
              key={s.subjectCode}
              onClick={() => setSelectedCode(s.subjectCode)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-900 hover:bg-slate-900 ${
                selectedCode === s.subjectCode ? 'bg-slate-900' : ''
              }`}
            >
              <div className="text-sm font-medium text-slate-100">{s.subjectCode}</div>
              <div className="text-xs text-slate-400">
                {s.subjectName ?? '—'} · {s.sessionCount} phiên · {s.totalPhotos} ảnh
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selectedCode && <p className="text-slate-500 text-sm">Chọn 1 sinh viên để xem ảnh/video đã chụp.</p>}
        {detailError && <p className="text-sm text-red-400">{detailError}</p>}
        {selectedCode && !detail && !detailError && <p className="text-sm text-slate-500">Đang tải...</p>}

        {detail && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">{detail.subjectCode}</h2>
              {detail.subjectName && <p className="text-sm text-slate-400">{detail.subjectName}</p>}
            </div>

            {detail.sessions.map((session) => (
              <div key={session.id} className="space-y-3">
                <div className="text-sm text-slate-400">
                  {formatDateTime(session.capturedAt ?? session.completedAt)} · {session.deviceName ?? '—'}
                </div>

                {(session.photos.length > 0 || session.videos.length > 0) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {session.photos.map((photo) => (
                      <div key={photo.id} className="rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                        <div className="aspect-[3/4] bg-slate-800 flex items-center justify-center text-xs text-slate-500">
                          {photo.viewUrl ? (
                            <img src={photo.viewUrl} alt={photo.cameraRole ?? photo.id} className="w-full h-full object-cover" />
                          ) : (
                            <span>{photo.fsStatus ?? 'chưa upload'}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {session.videos.map((video) => (
                      <div key={video.id} className="rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                        <div className="aspect-video bg-slate-800 flex items-center justify-center text-xs text-slate-500">
                          {video.viewUrl ? (
                            <video controls src={video.viewUrl} className="w-full h-full object-cover" />
                          ) : (
                            <span>{video.fsStatus ?? 'chưa upload'}</span>
                          )}
                        </div>
                        <div className="px-2 py-1 text-xs text-slate-400">{formatDurationMs(video.durationMs)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
