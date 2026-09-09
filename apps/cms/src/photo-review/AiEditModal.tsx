import { useEffect, useRef, useState } from 'react';
import { AiEditJob, AiEditRegion, ApiError, acceptVariant, getReviewJob, requestAiEdit } from '../api';
import { ModalShell } from '../components/CampaignDangerActions';
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

/**
 * "Sửa bằng AI" modal (§5.3) — `POST /v1/review/sets/:id/ai-edit` creates a
 * background job, this modal polls `GET /v1/review/jobs/:id` until it settles,
 * then only turns the result into a real version on an explicit "Chấp nhận"
 * (`POST /v1/review/variants/:id/accept`) — never auto-applied, per §6.2 rule
 * 5 ("con người chấp nhận").
 */
export function AiEditModal({
  setId,
  fromVariantId,
  onClose,
  onAccepted,
}: {
  setId: string;
  /** The version this edit starts from — pre-fills the job's `fromVariantId` so the server edits the current card, not always the original auto version. */
  fromVariantId?: string;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [region, setRegion] = useState<AiEditRegion>('OUTSIDE_FACE');
  const [job, setJob] = useState<AiEditJob | null>(null);
  const [running, setRunning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  function addChip(chip: string) {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}, ${chip}` : chip));
  }

  async function run() {
    if (!prompt.trim()) return;
    setRunning(true);
    setError(null);
    setJob(null);
    try {
      const created = await requestAiEdit(setId, { prompt: prompt.trim(), region, fromVariantId });
      setJob(created);
      if (created.status === 'PENDING' || created.status === 'RUNNING') {
        pollRef.current = window.setInterval(async () => {
          try {
            const polled = await getReviewJob(created.id);
            setJob(polled);
            if (polled.status === 'DONE' || polled.status === 'FAILED') {
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
    if (!job?.resultVariantId) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptVariant(job.resultVariantId);
      onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  }

  const similarity = job?.identitySimilarity;
  const tone = similarity != null ? similarityTone(similarity) : null;
  const canAccept = job?.status === 'DONE' && job.resultVariantId != null && (similarity == null || similarity >= 0.7);

  return (
    <ModalShell title="Sửa bằng AI" onClose={onClose}>
      <div className="space-y-4">
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

        {job && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 aspect-[3/4] flex items-center justify-center text-xs text-gray-400">
              Trước (ảnh hiện tại)
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 aspect-[3/4] flex items-center justify-center text-xs text-gray-400 overflow-hidden">
              {job.status === 'DONE' && job.previewUrl ? (
                <img src={job.previewUrl} alt="Kết quả AI" className="w-full h-full object-cover" />
              ) : job.status === 'FAILED' ? (
                <span className="text-red-600 px-2 text-center">{job.error ?? 'Xử lý lỗi'}</span>
              ) : (
                <span>Đang xử lý...</span>
              )}
            </div>
          </div>
        )}

        {job?.status === 'DONE' && (
          <div className="text-sm space-y-0.5">
            {similarity != null && tone && (
              <div>
                Độ giống với gốc:{' '}
                <span className={`font-semibold ${SIMILARITY_TONE_CLASS[tone]}`}>{similarity.toFixed(2)}</span>
              </div>
            )}
            <div className="text-xs text-gray-500">
              {job.durationMs != null && `Thời gian: ${(job.durationMs / 1000).toFixed(1)} s`}
              {job.modelId && ` · ${job.modelId}`}
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
            disabled={running || !prompt.trim()}
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
