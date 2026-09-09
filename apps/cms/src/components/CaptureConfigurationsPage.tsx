import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  CardSpec,
  CaptureConfiguration,
  CreateCaptureConfigurationInput,
  PhotoKind,
  UpdateCaptureConfigurationInput,
  createCaptureConfiguration,
  deleteCaptureConfiguration,
  listCaptureConfigurations,
  listPhotoKinds,
  updateCaptureConfiguration,
} from '../api';
import { CaptureAngleRow, captureStepToRow, fallbackRowsFromStepDefs, rowToCaptureStep } from '../captureAngleSteps';
import { CaptureAnglesTable, MIN_ROWS } from './CaptureAnglesTable';
import { CardSpecFields, DEFAULT_CARD_SPEC } from './CardSpecFields';

/**
 * "Mẫu chụp" (nav label) / "Mẫu cấu hình chụp" (page title) — item 10 of the
 * 2026-09-09 task brief: management page for reusable capture templates
 * (angle table + optional card spec) an admin can save once and reuse
 * across campaigns. Distinct from the existing "Cấu hình" nav item
 * (`/config`, `PhotoKindsPage` — `photo_kinds` standards per photo TYPE,
 * shared across campaigns rather than tied to one capture template) and
 * from "Góc chụp" (`/angle-presets`, `AnglePresetsPage` — the
 * individual-angle catalog a configuration's own rows are built FROM, one
 * level down). A campaign picks one of these from `CampaignForm.tsx`'s
 * "Chọn từ cấu hình có sẵn", which copies its `captureAngles`/`cardSpec`
 * values in once — see `CaptureConfiguration`'s own doc comment (apps/api)
 * for why this is a one-time-copy template, never a live link back to this
 * table.
 *
 * 2026-09-09 (product feedback, item 1/2 of that day's bug report): this
 * form's own card-spec section can now ALSO pull a saved `PhotoKind` (from
 * "Cấu hình") in as a starting point via `applyPhotoKind` below, instead of
 * only ever hand-typing `CardSpecFields`. Same one-time-copy convention as
 * `CampaignForm.tsx`'s picker — picking a kind here never creates a live
 * link to `photo_kinds`; there's no `photoKindId` column, by design.
 */
export function CaptureConfigurationsPage() {
  const [configs, setConfigs] = useState<CaptureConfiguration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CaptureConfiguration | null>(null);

  const reload = () => {
    listCaptureConfigurations()
      .then(setConfigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, []);

  async function handleDelete(config: CaptureConfiguration) {
    if (!window.confirm(`Xoá mẫu "${config.name}"? Campaign đã dùng mẫu này trước đây không bị ảnh hưởng.`)) return;
    try {
      await deleteCaptureConfiguration(config.id);
      setConfigs((prev) => prev?.filter((c) => c.id !== config.id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (formOpen) {
    return (
      <CaptureConfigurationForm
        config={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setFormOpen(false);
          setConfigs((prev) => {
            if (!prev) return [saved];
            const exists = prev.some((c) => c.id === saved.id);
            return exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev];
          });
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mẫu cấu hình chụp</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Mẫu góc chụp + chuẩn ảnh thẻ mà một campaign chọn dùng — campaign chọn một mẫu ở đây để điền sẵn thay vì
            nhập lại từ đầu. Khác với trang "Cấu hình" (chuẩn ảnh dùng chung nhiều campaign, theo từng loại ảnh): khi
            tạo/sửa mẫu ở đây, bạn có thể lấy chuẩn ảnh thẻ từ một "Cấu hình" đã lưu để không phải nhập tay lại.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shrink-0"
        >
          + Thêm mẫu
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {configs === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {configs && configs.length === 0 && (
        <p className="text-gray-500">Chưa có mẫu cấu hình nào — bấm "+ Thêm mẫu" để tạo mẫu góc chụp + chuẩn ảnh thẻ đầu tiên.</p>
      )}

      {configs && configs.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Mô tả</th>
              <th className="py-2.5 px-4">Số ảnh</th>
              <th className="py-2.5 px-4">Cần tối đa camera</th>
              <th className="py-2.5 px-4">Ảnh thẻ</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-900 font-medium">{c.name}</td>
                <td className="py-2.5 px-4 text-gray-500">{c.description || '—'}</td>
                <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.captureAngles.length}</td>
                <td className="py-2.5 px-4 text-gray-500 tabular-nums">{c.requiredCameraCount}</td>
                <td className="py-2.5 px-4 text-gray-500">
                  {c.cardSpec ? `${c.cardSpec.size ?? '?'} · ${c.cardSpec.dpi ?? '?'}dpi` : '—'}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={() => void handleDelete(c)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Xoá
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Full-width inline form (not a modal — `ModalShell`'s `max-w-md` is far too
 * narrow for `CaptureAnglesTable`, which needs `min-w-[860px]` and scrolls
 * internally rather than shrinking), matching `CampaignForm.tsx`'s own
 * treatment of the identical table. Replaces the list view while open
 * (`CaptureConfigurationsPage` above), same "form takes over the page,
 * Huỷ goes back to the list" pattern as `CreateCampaignPage`/`EditCampaignPage`.
 */
function CaptureConfigurationForm({
  config,
  onClose,
  onSaved,
}: {
  config: CaptureConfiguration | null;
  onClose: () => void;
  onSaved: (config: CaptureConfiguration) => void;
}) {
  const isEdit = config != null;
  const [name, setName] = useState(config?.name ?? '');
  const [description, setDescription] = useState(config?.description ?? '');
  const [rows, setRows] = useState<CaptureAngleRow[]>(() =>
    config ? config.captureAngles.map((step) => captureStepToRow(step)) : fallbackRowsFromStepDefs()
  );
  const [includeCardSpec, setIncludeCardSpec] = useState(config?.cardSpec != null);
  const [cardSpec, setCardSpec] = useState<CardSpec>(() => ({ ...DEFAULT_CARD_SPEC, ...(config?.cardSpec ?? {}) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Cấu hình đã lưu" (photo_kinds) picker — item 1/2 of the 2026-09-09 bug
  // report: an operator who already defined a photo-type standard in "Cấu
  // hình" had no way to reuse it here, only ever hand-typing `CardSpecFields`
  // from scratch. Same one-time-copy convention as `CampaignForm.tsx`'s own
  // `applyCaptureConfiguration` picker (see that function's doc comment) —
  // picking a kind here copies its `cardSpec` into the fields below, which
  // stay fully editable afterwards and save as this configuration's own
  // independent copy. No `photoKindId` link is stored anywhere.
  const [photoKinds, setPhotoKinds] = useState<PhotoKind[] | null>(null);
  const [selectedPhotoKindId, setSelectedPhotoKindId] = useState('');

  useEffect(() => {
    listPhotoKinds()
      .then(setPhotoKinds)
      .catch(() => setPhotoKinds([])); // non-critical — the picker just shows empty rather than blocking the form
  }, []);

  function applyPhotoKind(kindId: string) {
    setSelectedPhotoKindId(kindId);
    const kind = photoKinds?.find((k) => k.id === kindId);
    if (!kind) return;
    setCardSpec((prev) => ({ ...prev, ...kind.cardSpec }));
  }

  const activePhotoKinds = photoKinds?.filter((k) => k.active) ?? [];

  const tooFewRows = rows.length < MIN_ROWS;
  const cardSourceCount = rows.filter((r) => r.isCardSource).length;
  const canSubmit = name.trim().length > 0 && !tooFewRows && cardSourceCount === 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const captureAngles = rows.map((row, i) => rowToCaptureStep(row, i));

    try {
      if (isEdit && config) {
        const input: UpdateCaptureConfigurationInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          captureAngles,
          cardSpec: includeCardSpec ? cardSpec : null,
        };
        onSaved(await updateCaptureConfiguration(config.id, input));
      } else {
        const input: CreateCaptureConfigurationInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          captureAngles,
          cardSpec: includeCardSpec ? cardSpec : null,
        };
        onSaved(await createCaptureConfiguration(input));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
          ← Quay lại danh sách
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? `Sửa mẫu "${config?.name}"` : 'Thêm mẫu cấu hình chụp'}
        </h1>
      </div>

      <form onSubmit={submit} className="space-y-5 max-w-4xl">
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Tên mẫu</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="3 camera - Thẻ SV 4x6"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Mô tả</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Bảng góc chụp</h2>
          <CaptureAnglesTable rows={rows} onChange={setRows} />
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
          <label className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <input
              type="checkbox"
              checked={includeCardSpec}
              onChange={(e) => setIncludeCardSpec(e.target.checked)}
              className="rounded border-gray-300"
            />
            Kèm chuẩn ảnh thẻ
          </label>
          {includeCardSpec && (
            <div className="pt-1 space-y-3">
              <div>
                <label className="block text-sm text-gray-700 font-medium mb-1">Chọn từ Cấu hình đã lưu (tuỳ chọn)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    value={selectedPhotoKindId}
                    onChange={(e) => applyPhotoKind(e.target.value)}
                    className="flex-1 min-w-[12rem] bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  >
                    <option value="">— Nhập tay bên dưới —</option>
                    {activePhotoKinds.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.labelVi} ({k.cardSpec.size ?? '?'} · {k.cardSpec.dpi ?? '?'}dpi)
                      </option>
                    ))}
                  </select>
                  <Link to="/config" className="text-xs text-blue-700 hover:text-blue-900 underline shrink-0">
                    Quản lý Cấu hình →
                  </Link>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Chọn một "Cấu hình" (chuẩn ảnh dùng chung nhiều campaign) sẽ THAY THẾ toàn bộ chuẩn ảnh thẻ bên dưới
                  bằng chuẩn đã lưu — các ô vẫn chỉnh sửa được sau khi chọn, và bản chỉnh sửa chỉ lưu riêng cho mẫu
                  này, không ảnh hưởng ngược lại "Cấu hình" gốc.
                </p>
                {isEdit && !selectedPhotoKindId && (
                  <p className="text-xs text-amber-700 mt-1">
                    Đang dùng chuẩn ảnh đã lưu riêng của mẫu này — chọn một Cấu hình ở trên nếu muốn thay thế bằng
                    chuẩn dùng chung.
                  </p>
                )}
              </div>
              <CardSpecFields cardSpec={cardSpec} onChange={setCardSpec} />
            </div>
          )}
        </div>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !canSubmit}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu' : 'Tạo mẫu'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Huỷ
          </button>
          {tooFewRows && <span className="text-xs text-red-600 font-medium">Cần tối thiểu {MIN_ROWS} góc chụp</span>}
          {!tooFewRows && cardSourceCount !== 1 && (
            <span className="text-xs text-red-600 font-medium">Cần đúng 1 dòng làm ảnh thẻ</span>
          )}
        </div>
      </form>
    </div>
  );
}
