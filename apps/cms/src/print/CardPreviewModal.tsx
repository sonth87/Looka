import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { ModalShell } from '../components/CampaignDangerActions';

/**
 * "Xem trước thẻ" popup (in-thẻ mockup) — both the print-item preview
 * (`GET /v1/print/items/:id/preview`) and the card-template preview
 * (`POST /v1/card-templates/:id/preview`) return a raw PNG, not a URL, so
 * the caller resolves an already-authenticated blob object URL via
 * `fetchPreviewPngObjectUrl`/`previewPrintItemUrl`/`previewCardTemplateUrl`
 * (`api.ts`) and hands it here as `fetchUrl` — this component stays generic
 * over which of the two it's previewing.
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
  fetchUrl: (side: 'front' | 'back') => Promise<string>;
  onClose: () => void;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetchUrl(side)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
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
      </div>
    </ModalShell>
  );
}
