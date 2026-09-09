import { useEffect, useState } from 'react';
import { ApiError, UploadReplaceResult, uploadReplacePhoto } from '../api';
import { ModalShell } from '../components/CampaignDangerActions';
import { SIMILARITY_TONE_CLASS, similarityTone } from './reviewFormat';

/**
 * "Thay bằng ảnh tải lên" modal (§5.4) — validation (face count, resolution,
 * identity match against the original front angle) all happens server-side;
 * this modal just picks a file, previews it locally, submits, and surfaces
 * whatever similarity/warning the response carries.
 */
export function UploadReplaceModal({ setId, onClose, onDone }: { setId: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadReplaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadReplacePhoto(setId, file);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const similarity = result?.variant.identitySimilarity;
  const tone = similarity != null ? similarityTone(similarity) : null;
  const blocked = tone === 'bad';

  return (
    <ModalShell title="Thay bằng ảnh tải lên" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Chọn ảnh (JPG/PNG, tối đa 20 MB)</label>
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="w-full text-sm text-gray-700"
          />
        </div>

        {previewUrl && (
          <div className="w-32 rounded-lg border border-gray-200 overflow-hidden aspect-[3/4]">
            <img src={previewUrl} alt="Xem trước" className="w-full h-full object-cover" />
          </div>
        )}

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        {result && (
          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm space-y-1">
            {similarity != null && tone && (
              <div>
                Độ giống với ảnh gốc:{' '}
                <span className={`font-semibold ${SIMILARITY_TONE_CLASS[tone]}`}>{similarity.toFixed(2)}</span>
              </div>
            )}
            {result.warning && <div className="text-amber-600">{result.warning}</div>}
            {blocked && <div className="text-red-600 font-medium">Độ giống quá thấp — có thể không phải cùng người.</div>}
            {!blocked && <div className="text-emerald-600">Đã tạo phiên bản mới từ ảnh tải lên.</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Hủy
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!file || uploading}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
            >
              {uploading ? 'Đang tải lên...' : 'Dùng ảnh này'}
            </button>
          )}
          {result && !blocked && (
            <button
              type="button"
              onClick={onDone}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
            >
              Xong
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
