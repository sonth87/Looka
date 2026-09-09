import { useEffect, useState, type FormEvent } from 'react';
import {
  AnglePoseDefault,
  ApiError,
  CameraRoleName,
  CaptureAnglePreset,
  CreateAnglePresetInput,
  UpdateAnglePresetInput,
  createAnglePreset,
  listAnglePresets,
  updateAnglePreset,
} from '../api';
import { CAMERA_ROLE_LABELS } from '../captureAngles';
import { ModalShell } from './CampaignDangerActions';

const CAMERA_ROLES: CameraRoleName[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];

function poseSummary(pose: AnglePoseDefault): string {
  const parts: string[] = [];
  if (pose.yaw) parts.push(`yaw ${pose.yaw.target}±${pose.yaw.tolerance}`);
  if (pose.pitch) parts.push(`pitch ${pose.pitch.target}±${pose.pitch.tolerance}`);
  if (pose.roll) parts.push(`roll ${pose.roll.target}±${pose.roll.tolerance}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * C3 "Góc chụp" — the angle catalog admin page, new per
 * `campaign-config-sso-card-photo-discussion.md` §3.1.6 (dynamic angle
 * catalog: campaign forms no longer hardcode 5 fixed angles, they pick from
 * this table via `CaptureAnglesTable`'s picker). Endpoints per this app's
 * task spec: `GET/POST/PATCH /v1/capture-angle-presets`.
 */
export function AnglePresetsPage() {
  const [presets, setPresets] = useState<CaptureAnglePreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CaptureAnglePreset | null>(null);

  const reload = () => {
    listAnglePresets()
      .then(setPresets)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, []);

  const updateRow = (updated: CaptureAnglePreset) => {
    setPresets((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? prev);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Góc chụp</h1>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Thêm góc
        </button>
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {presets === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {presets && presets.length === 0 && (
        <p className="text-gray-500">Chưa có góc chụp nào trong danh mục.</p>
      )}

      {presets && presets.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Mã</th>
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Camera</th>
              <th className="py-2.5 px-4">Mặc định</th>
              <th className="py-2.5 px-4">Dùng</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {presets.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 font-mono text-xs text-gray-700">
                  {p.code}
                  {p.isSystem && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] align-middle">
                      hệ thống
                    </span>
                  )}
                  {!p.active && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] align-middle">
                      đã ẩn
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-900 font-medium">{p.labelVi}</td>
                <td className="py-2.5 px-4 text-gray-500">{CAMERA_ROLE_LABELS[p.preferredCameraRole]}</td>
                <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">{poseSummary(p.poseDefault)}</td>
                <td className="py-2.5 px-4 text-gray-500 tabular-nums">
                  {p.usageCount != null ? `${p.usageCount} cp` : '—'}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setEditing(p);
                        setFormOpen(true);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Sửa
                    </button>
                    {!p.isSystem && (
                      <button
                        onClick={() =>
                          void updateAnglePreset(p.id, { active: !p.active })
                            .then(updateRow)
                            .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
                        }
                        className="text-gray-500 hover:text-gray-800 font-medium"
                      >
                        {p.active ? 'Ẩn' : 'Hiện'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <AnglePresetFormModal
          preset={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false);
            setPresets((prev) => {
              if (!prev) return [saved];
              const exists = prev.some((p) => p.id === saved.id);
              return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
            });
          }}
        />
      )}
    </div>
  );
}

/** A small top-down head illustration, rotated by the yaw target being typed — the mockup's "hình minh họa đầu quay theo giá trị đang nhập" (§3 C3), kept intentionally simple (no asset, pure SVG + CSS transform). */
function YawPreview({ yaw }: { yaw: number }) {
  return (
    <div className="w-16 h-16 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0">
      <svg
        viewBox="0 0 100 100"
        width="44"
        height="44"
        style={{ transform: `rotate(${yaw}deg)`, transition: 'transform 120ms ease' }}
      >
        <circle cx="50" cy="50" r="38" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="2" />
        <polygon points="50,18 58,40 42,40" fill="#6b7280" />
      </svg>
    </div>
  );
}

function AnglePresetFormModal({
  preset,
  onClose,
  onSaved,
}: {
  preset: CaptureAnglePreset | null;
  onClose: () => void;
  onSaved: (preset: CaptureAnglePreset) => void;
}) {
  const isEdit = preset != null;
  const [code, setCode] = useState(preset?.code ?? '');
  const [labelVi, setLabelVi] = useState(preset?.labelVi ?? '');
  const [instructionVi, setInstructionVi] = useState(preset?.instructionVi ?? '');
  const [cameraRole, setCameraRole] = useState<CameraRoleName>(preset?.preferredCameraRole ?? 'CENTER');
  const [yawTarget, setYawTarget] = useState(preset?.poseDefault.yaw?.target ?? 0);
  const [yawTolerance, setYawTolerance] = useState(preset?.poseDefault.yaw?.tolerance ?? 10);
  const [pitchTarget, setPitchTarget] = useState(preset?.poseDefault.pitch?.target ?? 0);
  const [pitchTolerance, setPitchTolerance] = useState(preset?.poseDefault.pitch?.tolerance ?? 10);
  const [rollTarget, setRollTarget] = useState(preset?.poseDefault.roll?.target ?? 0);
  const [rollTolerance, setRollTolerance] = useState(preset?.poseDefault.roll?.tolerance ?? 10);
  const [useRoll, setUseRoll] = useState(preset?.poseDefault.roll != null);
  const [active, setActive] = useState(preset?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!labelVi.trim() || (!isEdit && !code.trim())) return;
    setSaving(true);
    setError(null);

    const poseDefault: AnglePoseDefault = {
      yaw: { target: yawTarget, tolerance: yawTolerance },
      pitch: { target: pitchTarget, tolerance: pitchTolerance },
      ...(useRoll ? { roll: { target: rollTarget, tolerance: rollTolerance } } : {}),
    };

    try {
      if (isEdit && preset) {
        const input: UpdateAnglePresetInput = {
          labelVi: labelVi.trim(),
          instructionVi: instructionVi.trim() || undefined,
          poseDefault,
          preferredCameraRole: cameraRole,
          active,
        };
        onSaved(await updateAnglePreset(preset.id, input));
      } else {
        const input: CreateAnglePresetInput = {
          code: code.trim(),
          labelVi: labelVi.trim(),
          instructionVi: instructionVi.trim() || undefined,
          poseDefault,
          preferredCameraRole: cameraRole,
          active,
        };
        onSaved(await createAnglePreset(input));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={isEdit ? `Sửa góc "${preset?.labelVi}"` : 'Thêm góc chụp'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-start gap-4">
          <div className="flex-1 space-y-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Mã{isEdit ? ' (không đổi được)' : ''}</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="LEFT_30"
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
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
          </div>
          <YawPreview yaw={yawTarget} />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Câu hướng dẫn cho SV</label>
          <input
            value={instructionVi}
            onChange={(e) => setInstructionVi(e.target.value)}
            placeholder="Quay mặt sang trái 30°"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Camera ưu tiên</label>
          <select
            value={cameraRole}
            onChange={(e) => setCameraRole(e.target.value as CameraRoleName)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {CAMERA_ROLES.map((role) => (
              <option key={role} value={role}>
                {CAMERA_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Yaw target / tolerance</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={yawTarget}
                onChange={(e) => setYawTarget(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
              <span className="text-gray-400">±</span>
              <input
                type="number"
                min={0}
                value={yawTolerance}
                onChange={(e) => setYawTolerance(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pitch target / tolerance</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={pitchTarget}
                onChange={(e) => setPitchTarget(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
              <span className="text-gray-400">±</span>
              <input
                type="number"
                min={0}
                value={pitchTolerance}
                onChange={(e) => setPitchTolerance(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
              />
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={useRoll} onChange={(e) => setUseRoll(e.target.checked)} className="rounded border-gray-300" />
          Đánh giá cả roll (nghiêng đầu)
        </label>
        {useRoll && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Roll target / tolerance</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={rollTarget}
                  onChange={(e) => setRollTarget(Number(e.target.value))}
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
                <span className="text-gray-400">±</span>
                <input
                  type="number"
                  min={0}
                  value={rollTolerance}
                  onChange={(e) => setRollTolerance(Number(e.target.value))}
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
              </div>
            </div>
          </div>
        )}

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
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu' : 'Tạo góc'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
