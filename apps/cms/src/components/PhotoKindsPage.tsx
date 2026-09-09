import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  CardSpec,
  CreatePhotoKindInput,
  PhotoKind,
  UpdatePhotoKindInput,
  createPhotoKind,
  listPhotoKinds,
  updatePhotoKind,
} from '../api';
import { ModalShell } from './CampaignDangerActions';

// `CardSpec`'s own fields are all optional (shared with `CampaignForm`'s
// looser "an older campaign might not have one at all" reading) — the
// concrete defaults below are typed as plain values, not `CardSpec`, so
// TypeScript doesn't force every read-site to re-guard against `undefined`
// on a value that, here, is always actually present.
const DEFAULT_SIZE = '4x6';
const DEFAULT_DPI = 300;
const DEFAULT_BACKGROUND_COLOR = '#FFFFFF';
const DEFAULT_HEAD_HEIGHT_RATIO: [number, number] = [0.7, 0.8];
const DEFAULT_EYE_LINE_RATIO: [number, number] = [0.4, 0.45];

function cardSpecSummary(spec: CardSpec): string {
  return `${spec.size ?? DEFAULT_SIZE} · ${spec.dpi ?? DEFAULT_DPI}dpi · nền ${spec.backgroundColor ?? DEFAULT_BACKGROUND_COLOR}`;
}

/**
 * "Cấu hình" — standalone admin page for "loại ảnh" (`photo_kinds`),
 * separate from any single campaign — shared standards (card size/dpi/
 * background, quality checks, AI-edit prompt hints) that every campaign
 * of that kind reuses. Same list+modal pattern as `AnglePresetsPage.tsx`.
 * No DELETE endpoint exists (same never-hard-delete convention used
 * throughout this API) — "Ẩn" (hide) is a PATCH `active: false`, and a
 * hidden kind can always be brought back with "Hiện".
 */
export function PhotoKindsPage() {
  const [kinds, setKinds] = useState<PhotoKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PhotoKind | null>(null);

  const reload = () => {
    listPhotoKinds()
      .then(setKinds)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, []);

  const updateRow = (updated: PhotoKind) => {
    setKinds((prev) => prev?.map((k) => (k.id === updated.id ? updated : k)) ?? prev);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cấu hình</h1>
          <p className="text-sm text-gray-500 mt-0.5">Chuẩn dùng chung cho từng loại ảnh (ảnh thẻ, ...), áp dụng cho mọi campaign.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Thêm loại ảnh
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {kinds === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {kinds && kinds.length === 0 && <p className="text-gray-500">Chưa có loại ảnh nào.</p>}

      {kinds && kinds.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Mã</th>
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Chuẩn ảnh</th>
              <th className="py-2.5 px-4">Gợi ý AI</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 font-mono text-xs text-gray-700">
                  {k.code}
                  {!k.active && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] align-middle">
                      đã ẩn
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-900 font-medium">{k.labelVi}</td>
                <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">{cardSpecSummary(k.cardSpec)}</td>
                <td className="py-2.5 px-4 text-gray-500">{k.promptHints.length} gợi ý</td>
                <td className="py-2.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setEditing(k);
                        setFormOpen(true);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={() =>
                        void updatePhotoKind(k.id, { active: !k.active })
                          .then(updateRow)
                          .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
                      }
                      className="text-gray-500 hover:text-gray-800 font-medium"
                    >
                      {k.active ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <PhotoKindFormModal
          kind={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false);
            setKinds((prev) => {
              if (!prev) return [saved];
              const exists = prev.some((k) => k.id === saved.id);
              return exists ? prev.map((k) => (k.id === saved.id ? saved : k)) : [...prev, saved];
            });
          }}
        />
      )}
    </div>
  );
}

function PhotoKindFormModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: PhotoKind | null;
  onClose: () => void;
  onSaved: (kind: PhotoKind) => void;
}) {
  const isEdit = kind != null;
  const [code, setCode] = useState(kind?.code ?? '');
  const [labelVi, setLabelVi] = useState(kind?.labelVi ?? '');
  const [size, setSize] = useState(kind?.cardSpec.size ?? DEFAULT_SIZE);
  const [dpi, setDpi] = useState(kind?.cardSpec.dpi ?? DEFAULT_DPI);
  const [backgroundColor, setBackgroundColor] = useState(kind?.cardSpec.backgroundColor ?? DEFAULT_BACKGROUND_COLOR);
  const [headMin, setHeadMin] = useState((kind?.cardSpec.headHeightRatio ?? DEFAULT_HEAD_HEIGHT_RATIO)[0]);
  const [headMax, setHeadMax] = useState((kind?.cardSpec.headHeightRatio ?? DEFAULT_HEAD_HEIGHT_RATIO)[1]);
  const [eyeMin, setEyeMin] = useState((kind?.cardSpec.eyeLineRatio ?? DEFAULT_EYE_LINE_RATIO)[0]);
  const [eyeMax, setEyeMax] = useState((kind?.cardSpec.eyeLineRatio ?? DEFAULT_EYE_LINE_RATIO)[1]);
  const [retouchEnabled, setRetouchEnabled] = useState(kind?.cardSpec.retouch?.enabled ?? true);
  const [promptHintsText, setPromptHintsText] = useState((kind?.promptHints ?? []).join('\n'));
  const [active, setActive] = useState(kind?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!labelVi.trim() || (!isEdit && !code.trim())) return;
    setSaving(true);
    setError(null);

    const cardSpec: CardSpec = {
      size,
      dpi,
      backgroundColor: backgroundColor.trim() || '#FFFFFF',
      headHeightRatio: [headMin, headMax],
      eyeLineRatio: [eyeMin, eyeMax],
      retouch: { enabled: retouchEnabled },
    };
    const promptHints = promptHintsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (isEdit && kind) {
        const input: UpdatePhotoKindInput = { labelVi: labelVi.trim(), cardSpec, promptHints, active };
        onSaved(await updatePhotoKind(kind.id, input));
      } else {
        const input: CreatePhotoKindInput = { code: code.trim().toUpperCase(), labelVi: labelVi.trim(), cardSpec, promptHints, active };
        onSaved(await createPhotoKind(input));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={isEdit ? `Sửa loại ảnh "${kind?.labelVi}"` : 'Thêm loại ảnh'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mã{isEdit ? ' (không đổi được)' : ''}</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={isEdit}
            placeholder="STUDENT_CARD"
            required
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tên hiển thị</label>
          <input
            value={labelVi}
            onChange={(e) => setLabelVi(e.target.value)}
            required
            placeholder="Ảnh thẻ sinh viên"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        <p className="text-sm font-medium text-gray-700 pt-1">Chuẩn ảnh thẻ</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cỡ</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            >
              <option value="3x4">3x4 cm</option>
              <option value="4x6">4x6 cm</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">DPI</label>
            <select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value))}
              className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
            >
              <option value={300}>300</option>
              <option value={600}>600</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Màu nền</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(backgroundColor) ? backgroundColor : '#ffffff'}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className="w-10 h-9 rounded border border-gray-300"
            />
            <input
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 font-mono text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tỉ lệ chiều cao đầu (min–max)</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={headMin}
                onChange={(e) => setHeadMin(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={headMax}
                onChange={(e) => setHeadMax(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tỉ lệ đường mắt (min–max)</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={eyeMin}
                onChange={(e) => setEyeMin(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={eyeMax}
                onChange={(e) => setEyeMax(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={retouchEnabled}
            onChange={(e) => setRetouchEnabled(e.target.checked)}
            className="rounded border-gray-300"
          />
          Tự động làm mịn ảnh khi tạo ảnh thẻ
        </label>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Gợi ý prompt sửa AI (mỗi dòng một gợi ý)</label>
          <textarea
            value={promptHintsText}
            onChange={(e) => setPromptHintsText(e.target.value)}
            rows={4}
            placeholder={'bỏ lóa kính\ngọn tóc lòa xòa\nthẳng cổ áo'}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm font-mono"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-gray-300" />
          Đang dùng được (bỏ chọn để ẩn khỏi danh mục)
        </label>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu' : 'Tạo loại ảnh'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
