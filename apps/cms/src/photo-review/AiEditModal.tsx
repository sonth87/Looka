import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AiEditRegion,
  AiEditSourceKind,
  ApiError,
  PhotoVariant,
  ReviewOriginalPhoto,
  acceptVariant,
  getReviewJob,
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
 * `POST /v1/review/sets/:id/ai-edit` runs SYNCHRONOUSLY on the server and
 * returns the resulting `photo_variants` row already at its final status
 * (`READY`/`FAILED`); `GET /v1/review/jobs/:id` re-reads that same shape.
 * The poll loop below only ever fires if a future async queue is added
 * behind this same contract (server's own doc comment) — today's request
 * always comes back already settled, so it never actually starts.
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
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const selectedSource = sourceOptions.find((o) => o.key === sourceKey) ?? null;

  function addChip(chip: string) {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}, ${chip}` : chip));
  }

  async function run() {
    if (!prompt.trim() || !selectedSource) return;
    setRunning(true);
    setError(null);
    setJob(null);
    try {
      const created = await requestAiEdit(setId, {
        prompt: prompt.trim(),
        region,
        sourceKind: selectedSource.sourceKind,
        fromVariantId: selectedSource.sourceKind === 'VARIANT' ? selectedSource.id : undefined,
        sourcePhotoId: selectedSource.sourceKind === 'ORIGINAL_PHOTO' ? selectedSource.id : undefined,
      });
      setJob(created);
      if (created.status === 'PROCESSING') {
        pollRef.current = window.setInterval(async () => {
          try {
            const polled = await getReviewJob(created.id);
            setJob(polled);
            if (polled.status === 'READY' || polled.status === 'FAILED') {
              if (pollRef.current) window.clearInterval(pollRef.current);
              setRunning(false);
            }
          } catch (err) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setRunning(false);
            setError(err instanceof ApiError ? err.message : String(err));
          }
        }, POLL_INTERVAL_MS);
      } else {
        setRunning(false);
      }
    } catch (err) {
      // A 422 here means the prompt was refused by the keyword filter (§5.3/§6.2 rule 4) — ApiError.message carries the server's explanation.
      setError(err instanceof ApiError ? err.message : String(err));
      setRunning(false);
    }
  }

  async function accept() {
    if (!job || job.status !== 'READY') return;
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
  const canAccept = job?.status === 'READY' && (similarity == null || similarity >= 0.7);

  return (
    <ModalShell title="Sửa bằng AI" onClose={onClose}>
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
          {region === 'FULL' && (
            <p className="text-xs text-gray-400 mt-1">
              Toàn ảnh: vùng mắt–mũi–miệng vẫn được dán lại từ ảnh gốc.
            </p>
          )}
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
            ) : job.status === 'READY' && job.viewUrl ? (
              <img src={job.viewUrl} alt="Kết quả AI" className="w-full h-full object-cover" />
            ) : job.status === 'FAILED' ? (
              <span className="text-red-600 px-2 text-center">{job.note ?? 'Xử lý lỗi'}</span>
            ) : (
              <span>Đang xử lý...</span>
            )}
          </div>
        </div>

        {job?.status === 'READY' && (
          <div className="text-sm space-y-0.5">
            {similarity != null && tone && (
              <div>
                Độ giống với gốc:{' '}
                <span className={`font-semibold ${SIMILARITY_TONE_CLASS[tone]}`}>{similarity.toFixed(2)}</span>
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
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
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
