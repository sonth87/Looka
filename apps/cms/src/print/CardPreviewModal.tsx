import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { ModalShell } from '../components/CampaignDangerActions';

/** What a preview fetch resolves to: a bare object URL, or the URL plus a short note to show under the image (e.g. "showing the approved photo — no template chosen yet"). */
export type PreviewResult = string | { url: string; note?: string | null };

/**
 * "Xem trước thẻ" popup (in-thẻ mockup) — both the print-item preview
 * (`GET /v1/print/items/:id/preview`) and the card-template preview
 * (`POST /v1/card-templates/:id/preview`) return a raw image, not a URL, so
 * the caller resolves an already-authenticated blob object URL via
 * `previewPrintItem`/`previewCardTemplateUrl` (`api.ts`) and hands it here as
 * `fetchUrl` — this component stays generic over which of the two it's
 * previewing. `fetchUrl` may return just the URL, or `{ url, note }` when the
 * caller has something worth telling the operator about what they're looking
 * at (2026-09-30: the print-item preview shows the approved card PHOTO when no
 * print template is configured, and says so).
 *
 * Front/back toggle is local UI state; switching sides re-calls `fetchUrl`
 * with the new side rather than pre-fetching both, since a preview render
 * is not free (real server-side compositing, not a cached static asset).
 */
export function CardPreviewModal({
  title,
  fetchUrl,
  onClose,
}: {
  title: string;
  fetchUrl: (side: 'front' | 'back') => Promise<PreviewResult>;
  onClose: () => void;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setNote(null);
    setUrl(null);
    fetchUrl(side)
      .then((result) => {
        const resolvedUrl = typeof result === 'string' ? result : result.url;
        if (cancelled) {
          URL.revokeObjectURL(resolvedUrl);
          return;
        }
        objectUrl = resolvedUrl;
        setUrl(resolvedUrl);
        setNote(typeof result === 'string' ? null : (result.note ?? null));
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [side, fetchUrl]);

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(['front', 'back'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                side === s ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s === 'front' ? 'Mặt trước' : 'Mặt sau'}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center min-h-[280px]">
          {loading && <p className="text-sm text-gray-500 py-10">Đang tạo ảnh xem trước...</p>}
          {error && <p className="text-sm text-red-600 py-10 px-4 text-center">{error}</p>}
          {url && !loading && !error && <img src={url} alt={title} className="max-w-full max-h-[60vh] rounded-lg shadow-md" />}
        </div>
        {note && !loading && !error && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{note}</p>}
      </div>
    </ModalShell>
  );
}
