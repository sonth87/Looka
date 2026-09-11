import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  ApiError,
  PhotoVariant,
  ReviewOriginalPhoto,
  ReviewSetDetail,
  approveReviewSet,
  getReviewSet,
  issuePhotoViewLink,
  rejectReviewSet,
  reprocessReviewSet,
  setCurrentVariant,
} from '../api';
import { ModalShell } from '../components/CampaignDangerActions';
import { classifyLinkError, LinkState } from '../components/SessionDetailDrawer';
import { AiEditModal } from './AiEditModal';
import { UploadReplaceModal } from './UploadReplaceModal';
import { REVIEW_STATUS_BADGE_CLASS, REVIEW_STATUS_LABEL, formatDateTime, isReviewSetLocked } from './reviewFormat';

/** Same fallback used by `SessionDetailDrawer.roleLabel` for a photo with no known camera role - `originalPhotos` has no `angleLabel` (never existed on the real API, see `ReviewOriginalPhotoDao`). */
function originalPhotoLabel(photo: ReviewOriginalPhoto): string {
  return photo.stepType ?? photo.cameraRole ?? 'Ảnh gốc';
}

const VARIANT_KIND_LABEL: Record<string, string> = {
  CARD_AUTO: 'Tự động',
  CARD_AI: 'AI',
  CARD_UPLOAD: 'Upload',
};

/**
 * "Duyệt ảnh" detail body (C5, cms-photo-review-plan.md §5.2) — the actual
 * fetch/actions/JSX, extracted 2026-09-09 so both `ReviewDetailPage` (the
 * full-page `/review/:id` route, kept as a fallback/deep-link) and
 * `ReviewDetailModal` (opened directly from `ReviewListPage`'s card grid,
 * per the product ask "chỉ cần hiển thị modal ảnh, không cần next page")
 * render identical fetch/action logic instead of two copies drifting apart.
 * Takes `id` as a prop rather than reading `useParams()` itself, since the
 * modal caller has no route param to read.
 *
 * `onClose`, when given, is used only for the Escape-key shortcut (guarded
 * against closing over an already-open nested modal/lightbox — same guard
 * `CampaignStudentsPanel`'s `StudentDetailDrawer` uses for its own nested
 * `SessionDetailDrawer`). `ReviewDetailPage` doesn't pass it, so Escape does
 * nothing there, same as before this refactor. The modal wrapper's backdrop
 * click and header ✕ button close unconditionally and live in
 * `ReviewDetailModal` itself, not here.
 *
 * Every action in the bottom bar is disabled with a lock message while
 * `isReviewSetLocked` — the one exception the plan calls out is "Tạo lại ảnh
 * 4x6" while `AUTO_FAILED` (§4/R-Q1).
 */
export function ReviewDetailContent({ id, onClose }: { id: string; onClose?: () => void }) {
  const [set, setSet] = useState<ReviewSetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Original photos carry no `viewUrl` of their own (unlike `PhotoVariant`,
  // which the service layer resolves server-side) - one must be requested
  // per photo, same as `SessionDetailDrawer` does for `SessionPhoto`.
  const [photoLinks, setPhotoLinks] = useState<Record<string, LinkState>>({});
  const retriedPhotoRef = useRef<Set<string>>(new Set());

  const reload = () => {
    getReviewSet(id)
      .then(setSet)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [id]);

  // Keyed on `set?.id` (a stable string once loaded), not `set` itself, so
  // this doesn't re-issue view-links every time `reload()` runs after an
  // approve/reject/reprocess/set-current-variant action - `originalPhotos`
  // is read-only and never changes across those.
  useEffect(() => {
    if (!set) return;
    let cancelled = false;
    retriedPhotoRef.current = new Set();

    // Every original photo gets a link request, not just ones that already
    // reached fs-core (fsFileId set) — 2026-09-10 fix, same as
    // SessionDetailDrawer's identical fix: the server's resolveViewSource
    // already falls back to this API's locally held bytes for a photo with
    // no fsFileId at all, but that path was unreachable from here since this
    // effect never even requested a link for such a photo.
    const withFile = set.originalPhotos;
    if (withFile.length === 0) {
      setPhotoLinks({});
      return;
    }
    setPhotoLinks(Object.fromEntries(withFile.map((p) => [p.id, { status: 'loading' as const }])));

    Promise.allSettled(withFile.map((p) => issuePhotoViewLink(p.id))).then((settled) => {
      if (cancelled) return;
      setPhotoLinks((prev) => {
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
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set?.id]);

  /** A stale (expired) token shows as a broken `<img>` - re-issue the link once, not in a retry loop. Mirrors `SessionDetailDrawer.retryLink`. */
  function retryPhotoLink(photoId: string) {
    if (retriedPhotoRef.current.has(photoId)) return;
    retriedPhotoRef.current.add(photoId);

    setPhotoLinks((prev) => ({ ...prev, [photoId]: { status: 'loading' } }));
    issuePhotoViewLink(photoId)
      .then((link) =>
        setPhotoLinks((prev) => ({ ...prev, [photoId]: { status: 'ready', url: link.url, viewUrl: link.viewUrl } }))
      )
      .catch((err) => setPhotoLinks((prev) => ({ ...prev, [photoId]: classifyLinkError(err) })));
  }

  const nestedOverlayOpen = aiModalOpen || uploadModalOpen || rejectModalOpen || lightboxUrl != null;

  useEffect(() => {
    if (!onClose) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !nestedOverlayOpen) onClose!();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, nestedOverlayOpen]);

  if (error) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!set) return <p className="text-gray-500">Đang tải...</p>;

  const locked = isReviewSetLocked(set);
  const canReprocess = set.status === 'AUTO_FAILED';

  async function withBusy(action: () => Promise<ReviewSetDetail>) {
    setBusy(true);
    setError(null);
    try {
      setSet(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const currentVariant = set.variants.find((v) => v.id === set.currentCardVariantId) ?? null;
  const sortedVariants = [...set.variants].sort((a, b) => b.version - a.version);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h1 className="text-2xl font-bold text-gray-900">{set.subjectCode}</h1>
        <span className="text-gray-500">{set.subjectName ?? '—'}</span>
        <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${REVIEW_STATUS_BADGE_CLASS[set.status]}`}>
          {REVIEW_STATUS_LABEL[set.status]}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6">{set.campaignName ?? set.campaignId}</p>

      {locked && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          {set.status === 'AUTO_FAILED'
            ? `Tạo ảnh 4x6 lỗi${set.failReason ? `: ${set.failReason}` : ''} — chỉ có thể tạo lại.`
            : 'Đang tạo ảnh 4x6 tự động — mọi hành động khác tạm khóa.'}
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Ảnh gốc (chỉ xem)</h2>
          <div className="grid grid-cols-3 gap-2">
            {set.originalPhotos.map((photo) => {
              const link = photoLinks[photo.id];
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => link?.status === 'ready' && setLightboxUrl(link.url)}
                  disabled={link?.status !== 'ready'}
                  className="aspect-square rounded-lg overflow-hidden bg-gray-50 border border-gray-200 relative"
                >
                  {(!link || link.status === 'loading') && (
                    <span className="text-[10px] text-gray-400 flex items-center justify-center h-full px-1 text-center">
                      Đang tải...
                    </span>
                  )}
                  {link?.status === 'ready' && (
                    <img
                      src={link.url}
                      onError={() => retryPhotoLink(photo.id)}
                      alt={originalPhotoLabel(photo)}
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              );
            })}
            {set.originalPhotos.length === 0 && <p className="text-xs text-gray-400 col-span-3">Chưa có ảnh gốc.</p>}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {set.originalPhotos.length} ảnh
            {set.sourceCapturedAt ? ` · Phiên ${formatDateTime(set.sourceCapturedAt)}` : ''}
            {set.sourceDeviceName ? ` (${set.sourceDeviceName})` : ''}
          </p>
          {/* Video intentionally not shown here (2026-09-09, "video ở trong phần duyệt ảnh không cần hiển thị") — this screen is for reviewing/approving the still photos only; `set.videos` is still fetched and used elsewhere (SessionDetailDrawer). */}
        </div>

        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Ảnh thẻ hiện tại{currentVariant ? ` — v${currentVariant.version} (${VARIANT_KIND_LABEL[currentVariant.kind] ?? currentVariant.kind})` : ''}
          </h2>
          <div className="aspect-[3/4] rounded-lg overflow-hidden bg-gray-50 border border-gray-200 flex items-center justify-center">
            {currentVariant?.viewUrl ? (
              <img src={currentVariant.viewUrl} alt="Ảnh thẻ hiện tại" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-gray-400">Chưa có ảnh thẻ hiện tại</span>
            )}
          </div>
          {currentVariant?.qualityReport && (
            <div className="mt-2 text-xs text-gray-500 space-y-0.5">
              {Object.entries(currentVariant.qualityReport).map(([k, v]) => (
                <div key={k}>
                  {k}: {String(v)}
                </div>
              ))}
            </div>
          )}
          {currentVariant?.identitySimilarity != null && (
            <p className="text-xs text-gray-500 mt-1">Độ giống với gốc: {currentVariant.identitySimilarity.toFixed(2)}</p>
          )}
        </div>

        <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Phiên bản</h2>
          <div className="space-y-2">
            {sortedVariants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                isCurrent={variant.id === set.currentCardVariantId}
                busy={busy}
                onSetCurrent={() => void withBusy(() => setCurrentVariant(id, variant.id))}
                onView={() => variant.viewUrl && setLightboxUrl(variant.viewUrl)}
              />
            ))}
            {sortedVariants.length === 0 && <p className="text-xs text-gray-400">Chưa có phiên bản nào.</p>}
          </div>

          {set.events.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <h3 className="text-xs font-medium text-gray-700 mb-1.5">Lịch sử</h3>
              <ul className="space-y-1 text-xs text-gray-500 max-h-40 overflow-y-auto">
                {set.events.map((ev) => (
                  <li key={ev.id}>
                    {formatDateTime(ev.at)} {ev.actorName ?? ''} — {ev.action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-wrap items-center gap-2">
        {locked ? (
          canReprocess ? (
            <button
              type="button"
              onClick={() => void withBusy(() => reprocessReviewSet(id))}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
            >
              Tạo lại ảnh 4x6
            </button>
          ) : (
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Hồ sơ đang khóa — chờ ảnh 4x6 tự động.
            </span>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              Sửa bằng AI
            </button>
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              Thay bằng ảnh tải lên
            </button>
            <button
              type="button"
              onClick={() => void withBusy(() => reprocessReviewSet(id))}
              disabled={busy}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
            >
              Tạo lại ảnh 4x6
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setRejectModalOpen(true)}
              disabled={busy}
              className="px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
            >
              Từ chối
            </button>
            <button
              type="button"
              onClick={() => void withBusy(() => approveReviewSet(id))}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
            >
              Duyệt
            </button>
          </>
        )}
      </div>

      {aiModalOpen && (
        <AiEditModal
          setId={id}
          fromVariantId={set.currentCardVariantId ?? undefined}
          onClose={() => setAiModalOpen(false)}
          onAccepted={() => {
            setAiModalOpen(false);
            reload();
          }}
        />
      )}

      {uploadModalOpen && (
        <UploadReplaceModal
          setId={id}
          onClose={() => setUploadModalOpen(false)}
          onDone={() => {
            setUploadModalOpen(false);
            reload();
          }}
        />
      )}

      {rejectModalOpen && (
        <RejectNoteModal
          onClose={() => setRejectModalOpen(false)}
          onConfirm={(note) => {
            setRejectModalOpen(false);
            void withBusy(() => rejectReviewSet(id, note || undefined));
          }}
        />
      )}

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}

function VariantRow({
  variant,
  isCurrent,
  busy,
  onSetCurrent,
  onView,
}: {
  variant: PhotoVariant;
  isCurrent: boolean;
  busy: boolean;
  onSetCurrent: () => void;
  onView: () => void;
}) {
  return (
    <div className={`p-2.5 rounded-lg border text-xs ${isCurrent ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
      <div className="flex items-center gap-1.5 font-medium text-gray-900">
        <span>{isCurrent ? '●' : '○'}</span>
        <span>
          v{variant.version} {VARIANT_KIND_LABEL[variant.kind] ?? variant.kind}
        </span>
        <span className="text-gray-400 font-normal ml-auto">{formatDateTime(variant.createdAt)}</span>
      </div>
      {variant.prompt && <div className="text-gray-500 mt-1 truncate" title={variant.prompt}>"{variant.prompt}"</div>}
      <div className="text-gray-500 mt-0.5">
        {variant.identitySimilarity != null && `giống ${variant.identitySimilarity.toFixed(2)}`}
        {variant.createdByName ? ` · ${variant.createdByName}` : ''}
      </div>
      <div className="flex gap-3 mt-1.5">
        {!isCurrent && (
          <button type="button" onClick={onSetCurrent} disabled={busy} className="text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40">
            Đặt hiện tại
          </button>
        )}
        <button type="button" onClick={onView} disabled={!variant.viewUrl} className="text-gray-600 hover:text-gray-800 font-medium disabled:opacity-40">
          Xem
        </button>
      </div>
    </div>
  );
}

function RejectNoteModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <ModalShell title="Từ chối hồ sơ" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Lý do (không bắt buộc)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={() => onConfirm(note.trim())}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm"
          >
            Từ chối
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <img src={url} alt="" className="relative max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  );
}
