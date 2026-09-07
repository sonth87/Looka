import { useEffect, useRef, useState } from 'react';
import { ApiError, SessionDetail, SessionPhoto, SessionStatus, getSession, issuePhotoViewLink } from '../api';
import { formatSessionDuration } from '../sessionFormat';

// Mirrors apps/api/src/common/errors/code.constants.error.ts - kept as plain
// numbers rather than importing across the REST boundary, same rationale as
// the rest of this client's hand-copied types (see api.ts's header comment).
const FILE_STORAGE_NOT_READY = 3000;
const FILE_STORAGE_UPSTREAM_ERROR = 3001;

const ROLE_LABEL: Record<string, string> = {
  CENTER: 'Chính diện',
  LEFT: 'Trái',
  RIGHT: 'Phải',
  UP: 'Trên',
  DOWN: 'Dưới',
};

const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  IN_PROGRESS: 'Đang chụp',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
};

const FS_STATUS_READY = ['READY'];
const FS_STATUS_PENDING = ['SCANNING', 'UPLOADING', 'SCAN_PENDING'];
const FS_STATUS_FAILED = ['QUARANTINED', 'FAILED'];

/** A photo's camera role, when known; otherwise fall back to the kiosk step - see the plan's mapping. */
function roleLabel(photo: SessionPhoto): string {
  if (photo.cameraRole && ROLE_LABEL[photo.cameraRole]) return ROLE_LABEL[photo.cameraRole];
  return photo.stepType ?? photo.stepId;
}

function fsStatusBadgeClass(fsStatus?: string): string {
  if (!fsStatus) return 'bg-gray-50 border-gray-200 text-gray-500';
  if (FS_STATUS_READY.includes(fsStatus)) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (FS_STATUS_PENDING.includes(fsStatus)) return 'bg-amber-50 border-amber-200 text-amber-700';
  if (FS_STATUS_FAILED.includes(fsStatus)) return 'bg-red-50 border-red-200 text-red-700';
  return 'bg-gray-50 border-gray-200 text-gray-500';
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Per-photo state of the fs-core view-link request that backs its `<img>`. */
type LinkState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; viewUrl?: string }
  | { status: 'not_ready' }
  | { status: 'upstream_error' }
  | { status: 'error'; message: string };

/** Classifies a rejected `issuePhotoViewLink` call by the API's domain error code, not just its HTTP status - both failure modes here return 503. */
function classifyLinkError(reason: unknown): LinkState {
  if (reason instanceof ApiError) {
    if (reason.code === FILE_STORAGE_NOT_READY) return { status: 'not_ready' };
    if (reason.code === FILE_STORAGE_UPSTREAM_ERROR) return { status: 'upstream_error' };
    return { status: 'error', message: reason.message };
  }
  return { status: 'error', message: String(reason) };
}

/**
 * Right-side drawer showing one capture session's photos (Phase 11). No
 * thumbnails are stored anywhere - the image IS a short-lived fs-core link,
 * requested for every photo that has reached the file server as soon as the
 * drawer opens.
 */
export function SessionDetailDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // A ref (not state) because it must be read-after-write synchronously inside
  // `retryLink` - state would still show the pre-update value if two `onError`
  // events fire back-to-back before a re-render lands.
  const retriedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    setLinks({});
    retriedRef.current = new Set();

    getSession(sessionId)
      .then(async (detail) => {
        if (cancelled) return;
        setSession(detail);

        // Only photos that already reached the file server get a link request -
        // the rest show "chưa upload" from their own fsStatus badge instead.
        const withFile = detail.photos.filter((p) => p.fsFileId);
        if (withFile.length === 0) return;
        setLinks(Object.fromEntries(withFile.map((p) => [p.id, { status: 'loading' as const }])));

        const settled = await Promise.allSettled(withFile.map((p) => issuePhotoViewLink(p.id)));
        if (cancelled) return;
        setLinks((prev) => {
          const next = { ...prev };
          settled.forEach((res, i) => {
            const photoId = withFile[i].id;
            next[photoId] =
              res.status === 'fulfilled'
                ? { status: 'ready', url: res.value.url, viewUrl: res.value.viewUrl }
                : classifyLinkError(res.reason);
          });
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /** A stale (expired) token shows as a broken `<img>` - re-issue the link once, not in a retry loop. */
  function retryLink(photoId: string) {
    if (retriedRef.current.has(photoId)) return;
    retriedRef.current.add(photoId);

    setLinks((prev) => ({ ...prev, [photoId]: { status: 'loading' } }));
    issuePhotoViewLink(photoId)
      .then((link) =>
        setLinks((prev) => ({ ...prev, [photoId]: { status: 'ready', url: link.url, viewUrl: link.viewUrl } }))
      )
      .catch((err) => setLinks((prev) => ({ ...prev, [photoId]: classifyLinkError(err) })));
  }

  function copyFsFileId(photo: SessionPhoto) {
    if (!photo.fsFileId) return;
    navigator.clipboard
      .writeText(photo.fsFileId)
      .then(() => {
        setCopiedId(photo.id);
        setTimeout(() => setCopiedId((cur) => (cur === photo.id ? null : cur)), 1500);
      })
      .catch(() => {
        /* clipboard permission denied or unavailable - nothing actionable to show */
      });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Phiên chụp #{sessionId.slice(0, 8)}</h2>
            {session && (
              <>
                <p className="text-sm text-gray-500 mt-0.5">
                  {session.deviceName ?? '—'} · {formatDateTime(session.capturedAt ?? session.completedAt)} ·{' '}
                  {SESSION_STATUS_LABEL[session.status]}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Thời gian chụp: <span className="font-medium text-gray-700">{formatSessionDuration(session.capturedAt, session.completedAt)}</span>
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1 shrink-0">
            ✕
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}

          {!session && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

          {session && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {session.photos.map((photo) => {
                const link = links[photo.id];
                return (
                  <div key={photo.id} className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                    <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center text-center text-xs text-gray-400 px-3">
                      {!photo.fsFileId && <span>Chưa upload lên file server</span>}
                      {photo.fsFileId && (!link || link.status === 'loading') && <span>Đang tải ảnh...</span>}
                      {photo.fsFileId && link && link.status === 'not_ready' && <span>Chưa có trên file server</span>}
                      {photo.fsFileId && link && link.status === 'upstream_error' && (
                        <span>File server không phản hồi</span>
                      )}
                      {photo.fsFileId && link && link.status === 'error' && <span>{link.message}</span>}
                      {photo.fsFileId && link && link.status === 'ready' && (
                        <img
                          src={link.url}
                          onError={() => retryLink(photo.id)}
                          alt={roleLabel(photo)}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 text-sm">
                          {roleLabel(photo)}
                          {photo.attempt > 1 ? ` · lần ${photo.attempt}` : ''}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full border text-xs font-medium shrink-0 ${fsStatusBadgeClass(photo.fsStatus)}`}
                        >
                          {photo.fsStatus ?? 'chưa upload'}
                        </span>
                      </div>
                      {photo.localStatus && <div className="text-xs text-gray-400">Cục bộ: {photo.localStatus}</div>}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() =>
                            link &&
                            link.status === 'ready' &&
                            window.open(link.viewUrl ?? link.url, '_blank', 'noopener,noreferrer')
                          }
                          disabled={!link || link.status !== 'ready'}
                          className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40 disabled:hover:bg-blue-600"
                        >
                          Mở ảnh gốc
                        </button>
                        <button
                          onClick={() => copyFsFileId(photo)}
                          disabled={!photo.fsFileId}
                          className="flex-1 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium disabled:opacity-40 hover:bg-gray-100"
                        >
                          {copiedId === photo.id ? 'Đã sao chép' : 'Sao chép fs_file_id'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
