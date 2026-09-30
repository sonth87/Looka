import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AiEditRegion,
  AiEditSourceKind,
  ApiError,
  PhotoVariant,
  ReviewOriginalPhoto,
  acceptVariant,
  getReviewJob,
  isVariantDone,
  isVariantInFlight,
  requestAiEdit,
} from '../api';
import { ModalShell } from '../components/CampaignDangerActions';
import type { LinkState } from '../components/SessionDetailDrawer';
import { SIMILARITY_TONE_CLASS, similarityTone } from './reviewFormat';

/** §5.3's clickable suggestion chips — appended to the prompt textarea, never sent as separate structured data (the endpoint only takes free-text `prompt`). */
const SUGGESTION_CHIPS = [
  'bỏ lóa kính',
  'gọn tóc lòa xòa',
  'thẳng cổ áo',
  'nền trắng đều',
  'bỏ bụi/vết trên nền',
  'cân sáng hai bên mặt',
];

const REGION_OPTIONS: { value: AiEditRegion; label: string }[] = [
  { value: 'OUTSIDE_FACE', label: 'Ngoài khuôn mặt' },
  { value: 'GLASSES', label: 'Kính' },
  { value: 'HAIR', label: 'Tóc' },
  { value: 'FULL', label: 'Toàn ảnh' },
];

const POLL_INTERVAL_MS = 1500;
/** A poll that fails this many times in a row (network blip, brief 5xx) gives up — see `schedulePoll`'s own doc comment. */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/** Fallback label for an original photo with no known camera role — same convention `ReviewDetailContent.originalPhotoLabel` uses. */
function originalPhotoLabel(photo: ReviewOriginalPhoto): string {
  return photo.stepType ?? photo.cameraRole ?? 'Ảnh gốc';
}

/** One entry in the source picker `<select>` — either an original `photos` row or a non-discarded `photo_variants` row, normalized to one shape so the dropdown/preview logic doesn't branch on which. */
interface SourceOption {
  key: string;
  sourceKind: AiEditSourceKind;
  id: string;
  label: string;
  previewUrl?: string;
}

/**
 * "Sửa bằng AI" modal (§5.3, Giai đoạn 5 §5.1 feature 12) —
 * `POST /v1/review/sets/:id/ai-edit` runs ASYNCHRONOUSLY on the server
 * (2026-09-29 — enqueued onto BullMQ's user-priority lane) and returns the
 * resulting `photo_variants` row at `PROCESSING`; `GET /v1/review/jobs/:id`
 * re-reads that same shape as it settles. The poll loop below fires
 * whenever the initial response (or a later poll) is still `isVariantInFlight`
 * (`DRAFT`/`PROCESSING`) — a user's own click here always jumps ahead of
 * any already-queued background/kiosk-auto/recovery job (see
 * `PhotoReviewService.reprocess`/`aiEdit`'s own doc comments on
 * `AiEditJobOrigin.USER`), so this modal should settle quickly in practice.
 * A retryable server-side failure (the call to the AI service timed out, or
 * hit a transient error) does NOT get its own status (2026-09-29, "bỏ
 * PENDING đi") — the variant just stays `PROCESSING` while the server's own
 * `AiEditRecoveryService` sweep retries it in the background, so this modal
 * keeps polling straight through a retry and only ever stops on `DONE`/
 * `READY`/`FAILED`.
 *
 * Only turns the result into a real version on an explicit "Chấp nhận"
 * (`POST /v1/review/variants/:id/accept`) — never auto-applied, per §6.2
 * rule 5 ("con người chấp nhận").
 */
export function AiEditModal({
  setId,
  currentCardVariantId,
  originalPhotos,
  photoLinks,
  variants,
  onClose,
  onAccepted,
}: {
  setId: string;
  /** Default source selection — the set's current card variant, if any. */
  currentCardVariantId?: string;
  /** This session's captured photos — one half of the source picker (Giai đoạn 5 feature 12). */
  originalPhotos: ReviewOriginalPhoto[];
  /** Already-resolved view links for `originalPhotos`, keyed by photo id — reused from `ReviewDetailContent`'s own fetch so this modal never re-issues them. */
  photoLinks: Record<string, LinkState>;
  /** This set's existing variants — the other half of the source picker. */
  variants: PhotoVariant[];
  onClose: () => void;
  onAccepted: () => void;
}) {
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const fromPhotos: SourceOption[] = originalPhotos.map((p) => {
      const link = photoLinks[p.id];
      return {
        key: `photo:${p.id}`,
        sourceKind: 'ORIGINAL_PHOTO',
        id: p.id,
        label: `Ảnh gốc — ${originalPhotoLabel(p)} (lần ${p.attempt})`,
        previewUrl: link?.status === 'ready' ? link.url : undefined,
      };
    });
    const fromVariants: SourceOption[] = variants
      .filter((v) => v.status !== 'DISCARDED')
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        key: `variant:${v.id}`,
        sourceKind: 'VARIANT',
        id: v.id,
        label: `Phiên bản v${v.version} (${v.kind === 'CARD_AI' ? 'AI' : v.kind === 'CARD_UPLOAD' ? 'Upload' : 'Tự động'})${v.id === currentCardVariantId ? ' — hiện tại' : ''}`,
        previewUrl: v.viewUrl,
      }));
    return [...fromVariants, ...fromPhotos];
  }, [originalPhotos, photoLinks, variants, currentCardVariantId]);

  const defaultSourceKey = useMemo(() => {
    const current = sourceOptions.find(
      (o) => o.sourceKind === 'VARIANT' && o.id === currentCardVariantId,
    );
    return current?.key ?? sourceOptions[0]?.key ?? '';
  }, [sourceOptions, currentCardVariantId]);

  const [sourceKey, setSourceKey] = useState(defaultSourceKey);
  const [prompt, setPrompt] = useState('');
  const [region, setRegion] = useState<AiEditRegion>('OUTSIDE_FACE');
  const [job, setJob] = useState<PhotoVariant | null>(null);
  const [running, setRunning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  /**
   * Bumped at the start of every `run()` call and on unmount — see
   * `schedulePoll`'s own doc comment for why every poll response is checked
   * against this before being applied.
   */
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      pollGenerationRef.current += 1;
      if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const selectedSource = sourceOptions.find((o) => o.key === sourceKey) ?? null;

  // Guarded close (2026-09-29, fixed): `POST .../ai-edit` now runs a real
  // generative model and can take minutes. Closing this modal (backdrop,
  // ✕, or "Hủy") while `running` used to unmount it with the request still
  // in flight on the server — reopening it then showed a fresh `running:
  // false`/`job: null` state, inviting a second "Chạy" click that queued a
  // second job behind the first on the same single-worker AI service, with
  // the first run's result never shown anywhere. The request itself is not
  // cancelled (there is no cancellation endpoint), so this only stops the
  // person from losing track of it — see `run()`'s own comment for what
  // happens to that first result once it lands.
  //
  // 2026-09-30 fix (confirmed audit finding): a RETRYING job (`PROCESSING`
  // with a `note` — the server keeps it at `PROCESSING` through a
  // retryable failure instead of a separate status, see this component's
  // own top doc comment) can now sit behind the recovery sweep's 5-minute
  // cron and a background-lane queue for tens of minutes, up to
  // `AI_EDIT_MAX_ATTEMPTS` retries. The guard above trapped the reviewer in
  // this modal for that whole window with no way out except reloading the
  // page. Closing here does not touch the server-side job — it keeps
  // retrying regardless — and reopening this modal and clicking "Chạy"
  // again WOULD still start a genuinely new job on top of it (unchanged:
  // `aiEdit()` always creates a fresh variant), same risk the original
  // 2026-09-29 fix was written to prevent. That risk is deliberately
  // accepted here, now bounded by `aiEdit()`'s own per-set in-flight cap
  // (`AI_EDIT_MAX_IN_FLIGHT_PER_SET`) rather than unlimited — a better
  // trade than leaving the reviewer with no way to close this modal at all
  // for the entire retry window.
  const retryPending = job?.status === 'PROCESSING' && !!job.note;
  function handleClose() {
    if (running && !retryPending) return;
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    pollGenerationRef.current += 1;
    onClose();
  }

  function addChip(chip: string) {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}, ${chip}` : chip));
  }

  /**
   * Chains each poll off a `setTimeout` scheduled only once the PREVIOUS
   * one's own response has been handled (2026-09-30 fix — confirmed audit
   * finding), instead of an unconditional `setInterval` that let requests
   * overlap: a slower-but-earlier PROCESSING response could land AFTER a
   * faster-but-later terminal DONE/FAILED one had already arrived and
   * stopped polling, overwriting it and leaving the modal stuck on "Đang
   * xử lý..." forever with nothing left to un-stick it.
   *
   * `generation` is captured once per `run()` call (and bumped on unmount/
   * `handleClose`) and checked before every state update below — a
   * response that arrives after this run's own poll chain was superseded
   * or torn down is dropped silently instead of applied.
   *
   * A single transient poll error (a network blip, a brief 5xx) used to
   * stop polling for good even though the job keeps running server-side
   * for minutes; this retries up to `MAX_CONSECUTIVE_POLL_ERRORS` times
   * before actually giving up.
   */
  function schedulePoll(jobId: string, generation: number, consecutiveErrors = 0) {
    pollTimeoutRef.current = window.setTimeout(async () => {
      if (generation !== pollGenerationRef.current) return;
      try {
        const polled = await getReviewJob(jobId);
        if (generation !== pollGenerationRef.current) return;
        setJob(polled);
        if (isVariantInFlight(polled.status)) {
          schedulePoll(jobId, generation, 0);
        } else {
          // Stops on DONE/READY/FAILED only — a retryable failure keeps
          // the variant at PROCESSING (no separate status), so polling
          // continues straight through the server's own retry.
          pollTimeoutRef.current = null;
          setRunning(false);
        }
      } catch (err) {
        if (generation !== pollGenerationRef.current) return;
        const nextErrors = consecutiveErrors + 1;
        if (nextErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          pollTimeoutRef.current = null;
          setRunning(false);
          setError(err instanceof ApiError ? err.message : String(err));
        } else {
          schedulePoll(jobId, generation, nextErrors);
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function run() {
    if (!prompt.trim() || !selectedSource) return;
    setRunning(true);
    setError(null);
    setJob(null);
    // New poll chain for this run — invalidates any previous one still
    // scheduled (defensive: "Chạy"/"Chạy lại" is disabled while `running`,
    // so this should not normally overlap a live chain).
    const generation = ++pollGenerationRef.current;
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    try {
      const created = await requestAiEdit(setId, {
        prompt: prompt.trim(),
        region,
        sourceKind: selectedSource.sourceKind,
        fromVariantId: selectedSource.sourceKind === 'VARIANT' ? selectedSource.id : undefined,
        sourcePhotoId: selectedSource.sourceKind === 'ORIGINAL_PHOTO' ? selectedSource.id : undefined,
      });
      if (generation !== pollGenerationRef.current) return;
      setJob(created);
      if (isVariantInFlight(created.status)) {
        schedulePoll(created.id, generation);
      } else {
        setRunning(false);
      }
    } catch (err) {
      if (generation !== pollGenerationRef.current) return;
      // A 422 here means the prompt was refused by the keyword filter (§5.3/§6.2 rule 4) — ApiError.message carries the server's explanation.
      setError(err instanceof ApiError ? err.message : String(err));
      setRunning(false);
    }
  }

  async function accept() {
    if (!job || !isVariantDone(job.status)) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptVariant(job.id);
      onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  }

  const similarity = job?.identitySimilarity ?? undefined;
  const tone = similarity != null ? similarityTone(similarity) : null;
  const canAccept = !!job && isVariantDone(job.status) && (similarity == null || similarity >= 0.7);

  return (
    <ModalShell title="Sửa bằng AI" onClose={handleClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Ảnh nguồn</label>
          <select
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm"
          >
            {sourceOptions.length === 0 && <option value="">Chưa có ảnh nào để sửa</option>}
            {sourceOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Yêu cầu</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Ví dụ: Bỏ lóa trên kính, giữ nguyên khuôn mặt"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => addChip(chip)}
              className="px-2.5 py-1 rounded-full border border-gray-300 text-xs text-gray-600 hover:bg-gray-100"
            >
              {chip}
            </button>
          ))}
        </div>

        <div>
          <div className="text-sm text-gray-500 mb-1.5">Vùng được sửa</div>
          <div className="flex flex-wrap gap-3">
            {REGION_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  name="ai-edit-region"
                  checked={region === opt.value}
                  onChange={() => setRegion(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {/* Fixed 2026-09-29: this used to claim (only for FULL) that the
              eye-nose-mouth region is "still pasted back from the original" —
              false today. The backend's own AI-edit service has no region
              mask at all; it edits the whole image from the prompt text and
              this field is recorded on the variant as descriptive metadata
              only, never actually sent to or enforced by that service (see
              PhotoReviewService.aiEdit's own comment on `region`). Shown for
              every option, not only FULL, since none of them limit what the
              model can change — the forbidden-keyword prompt filter is the
              only real guard today. */}
          <p className="text-xs text-gray-400 mt-1">
            Lưu ý: đây chỉ là ghi chú mô tả — service AI hiện sửa toàn bộ ảnh
            theo yêu cầu, không giới hạn theo vùng đã chọn.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 aspect-[3/4] flex items-center justify-center text-xs text-gray-400 overflow-hidden">
            {selectedSource?.previewUrl ? (
              <img src={selectedSource.previewUrl} alt="Ảnh nguồn" className="w-full h-full object-cover" />
            ) : (
              'Trước (ảnh nguồn)'
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 aspect-[3/4] flex items-center justify-center text-xs text-gray-400 overflow-hidden">
            {!job ? (
              <span>Chưa chạy</span>
            ) : isVariantDone(job.status) && job.viewUrl ? (
              <img src={job.viewUrl} alt="Kết quả AI" className="w-full h-full object-cover" />
            ) : job.status === 'FAILED' ? (
              <span className="text-red-600 px-2 text-center">{job.note ?? 'Xử lý lỗi'}</span>
            ) : (
              <span>Đang xử lý...</span>
            )}
          </div>
        </div>

        {job && isVariantDone(job.status) && (
          <div className="text-sm space-y-0.5">
            {similarity != null && tone ? (
              <div>
                Độ giống với gốc:{' '}
                <span className={`font-semibold ${SIMILARITY_TONE_CLASS[tone]}`}>{similarity.toFixed(2)}</span>
              </div>
            ) : (
              // 2026-09-29 user decision (fail-open, not fail-closed — the
              // identity backend is permanently down): accept still stays
              // allowed with a null score, but this must never look the
              // same as "checked and passed" — explicit, visible warning
              // instead of silently showing nothing.
              <div className="text-amber-600 text-xs font-medium">
                ⚠ Chưa xác minh được danh tính (dịch vụ kiểm tra hiện không hoạt động) — tự kiểm tra bằng mắt trước
                khi chấp nhận.
              </div>
            )}
            <div className="text-xs text-gray-500">
              {job.modelId && `${job.modelId}`}
              {job.seed != null && ` · Seed: ${job.seed}`}
            </div>
            {tone === 'bad' && (
              <div className="text-red-600 text-xs font-medium">Độ giống quá thấp — không thể chấp nhận.</div>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
          AI không làm: đổi biểu cảm, mở mắt, bỏ hẳn kính, làm gầy mặt, tô đẹp — các yêu cầu này bị từ chối trước khi
          chạy.
        </p>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={running && !retryPending}
            title={
              running && !retryPending
                ? 'Yêu cầu vẫn đang chạy trên máy chủ — không thể đóng'
                : retryPending
                  ? 'Hệ thống sẽ tự chạy lại yêu cầu này ở phía máy chủ — có thể đóng cửa sổ này'
                  : undefined
            }
            className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !prompt.trim() || !selectedSource}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold text-sm disabled:opacity-50"
          >
            {running ? 'Đang chạy...' : job ? 'Chạy lại' : 'Chạy'}
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={!canAccept || accepting}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {accepting ? 'Đang lưu...' : 'Chấp nhận → thành phiên bản mới'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
