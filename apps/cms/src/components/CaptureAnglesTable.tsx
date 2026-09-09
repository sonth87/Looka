import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';
import { ApiError, CameraRoleName, CaptureAnglePreset, listAnglePresets } from '../api';
import { CAMERA_ROLE_LABELS, DEFAULT_PHYSICAL_ANGLES } from '../captureAngles';
import {
  CaptureAngleRow,
  fallbackRowsFromStepDefs,
  makeRowKey,
  presetToRow,
  requiredCameraCount,
} from '../captureAngleSteps';
import { ModalShell } from './CampaignDangerActions';

const CAMERA_ROLES: CameraRoleName[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];
// 2026-09-08 (product feedback): lowered from 2 — a campaign with a single
// target photo is a real, allowed case now, not just a degenerate one.
// Kept in sync with the backend's own MIN_STEPS
// (apps/api/.../capture-angles.validator.ts) — a mismatch here would only
// ever show up as a confusing 400 on save, not a client-side message.
export const MIN_ROWS = 1;
export const MAX_ROWS = 20; // §3.1.1: MIN_STEPS/MAX raised from 2–5 to 2–20 (min later lowered again to 1, see above).

/**
 * Free-form, reorderable N-row angle table — the "Ảnh chụp" section of
 * `CampaignForm` (C2.2 mockup) and replacement for `CaptureFramesEditor`'s
 * fixed 5-toggle grid, per `campaign-config-sso-card-photo-discussion.md`
 * §3.1.3. Purely a controlled `rows`/`onChange` pair, same shape as
 * `CaptureFramesEditor`'s old `enabled`/`onToggle` — `CampaignForm` owns the
 * actual draft state and turns it into `captureAngles` on submit.
 */
export function CaptureAnglesTable({
  rows,
  onChange,
}: {
  rows: CaptureAngleRow[];
  onChange: (rows: CaptureAngleRow[]) => void;
}) {
  const [presets, setPresets] = useState<CaptureAnglePreset[] | null>(null);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templateConfirm, setTemplateConfirm] = useState<'5' | '10' | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // "Số ảnh cần chụp" as free-typed text while the field has focus, so a
  // user clearing the box to type "10" doesn't get clamped back to "1"
  // (MIN_ROWS) after every keystroke — only committed (added/removed rows)
  // on blur/Enter. Re-synced from `rows.length` whenever the row count
  // changes some other way (picker, template, delete button).
  const [countDraft, setCountDraft] = useState(String(rows.length));
  useEffect(() => setCountDraft(String(rows.length)), [rows.length]);

  useEffect(() => {
    listAnglePresets()
      .then((list) => setPresets(list.filter((p) => p.active !== false)))
      .catch((err) => setPresetsError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const cardSourceCount = rows.filter((r) => r.isCardSource).length;
  const belowMin = rows.length < MIN_ROWS;
  const atMax = rows.length >= MAX_ROWS;
  const cameraCount = requiredCameraCount(rows);

  function updateRow(key: string, patch: Partial<CaptureAngleRow>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch, confirmed: true } : r)));
  }

  function updatePoseAxis(key: string, axis: 'yaw' | 'pitch', field: 'target' | 'tolerance', value: number) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const current = row.pose[axis] ?? { target: 0, tolerance: 10 };
    updateRow(key, { pose: { ...row.pose, [axis]: { ...current, [field]: value } } });
  }

  /**
   * Picking a camera for this row also seeds its pose target to that
   * camera's own physical mounting angle (2026-09-09 fix, "chụp đồng thời 3
   * cam") — see `DEFAULT_PHYSICAL_ANGLES`'s own doc comment for why this
   * exact value, not the subject-turn-style default `updateRow` would
   * otherwise leave in place.
   *
   * Only ever touches an axis the row is already using, OR the new role's
   * own primary axis (yaw for LEFT/RIGHT, pitch for UP/DOWN) when the row
   * has nothing there yet — never the OTHER axis. Forcing a target onto an
   * axis the row was deliberately leaving unconstrained (`pose.yaw`/`pitch`
   * absent — matches *any* value, per `anglesMatch`) would make grouping
   * MORE restrictive than intended, blocking a legitimate combined angle
   * (e.g. an UP row meant to also share a round with a LEFT-camera row) —
   * exactly the over-tightening the "đừng làm lỏng kiểm tra góc" instruction
   * warned against, just from the opposite direction. A row that already
   * has both axes set (a genuine combined CUSTOM angle) keeps both, each
   * corrected to the new role's own value.
   */
  function handleCameraRoleChange(key: string, nextRole: CameraRoleName) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const angle = DEFAULT_PHYSICAL_ANGLES[nextRole];
    const nextPose = { ...row.pose };
    const touchYaw = !!row.pose.yaw || nextRole === 'LEFT' || nextRole === 'RIGHT';
    const touchPitch = !!row.pose.pitch || nextRole === 'UP' || nextRole === 'DOWN';
    if (touchYaw) nextPose.yaw = { target: angle.yaw, tolerance: row.pose.yaw?.tolerance ?? 10 };
    if (touchPitch) nextPose.pitch = { target: angle.pitch, tolerance: row.pose.pitch?.tolerance ?? 10 };
    updateRow(key, { cameraRole: nextRole, pose: nextPose });
  }

  function removeRow(key: string) {
    onChange(rows.filter((r) => r.key !== key));
  }

  function moveRow(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function setCardSource(key: string) {
    onChange(rows.map((r) => ({ ...r, isCardSource: r.key === key })));
  }

  /**
   * "Số ảnh cần chụp" typed directly — 2026-09-08, product request. Adds or
   * removes rows to reach the typed count: a new row is a blank, unconfirmed
   * placeholder (same amber "chưa xác nhận" treatment a fresh preset pick
   * gets) the operator still has to fill in — there's no way to invent a
   * real angle/camera/pose out of thin air from a bare number. Removing
   * always trims from the end; if that would delete the current ảnh-thẻ
   * row, the new last row becomes the ảnh-thẻ row instead of leaving none.
   */
  function commitTargetCount() {
    const parsed = Number(countDraft);
    if (!Number.isFinite(parsed)) {
      setCountDraft(String(rows.length));
      return;
    }
    const target = Math.round(Math.max(MIN_ROWS, Math.min(MAX_ROWS, parsed)));
    setCountDraft(String(target));
    if (target === rows.length) return;

    if (target > rows.length) {
      const additions: CaptureAngleRow[] = Array.from({ length: target - rows.length }, () => ({
        key: makeRowKey(),
        label: 'Góc chụp mới',
        instruction: '',
        cameraRole: 'CENTER',
        pose: {},
        isCardSource: false,
        confirmed: false,
      }));
      onChange([...rows, ...additions]);
    } else {
      const next = rows.slice(0, target);
      if (next.length > 0 && !next.some((r) => r.isCardSource)) {
        next[next.length - 1] = { ...next[next.length - 1], isCardSource: true };
      }
      onChange(next);
    }
  }

  function addFromPreset(preset: CaptureAnglePreset) {
    onChange([...rows, presetToRow(preset, rows.length === 0)]);
    setPickerOpen(false);
  }

  function applyTemplate(size: '5' | '10') {
    const source = presets && presets.length > 0 ? presets : null;
    let nextRows: CaptureAngleRow[];
    if (source) {
      const count = size === '5' ? 5 : 10;
      const picked = [...source].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).slice(0, count);
      nextRows = picked.map((p, i) => presetToRow(p, i === 0));
    } else {
      // No catalog reachable — fall back to the fixed 5 legacy angles;
      // "Mẫu 10 ảnh" without a live catalog just repeats that set once
      // (documented limitation — the canonical 10-angle set is an open
      // question in the source plan, §3.1.5's Q17).
      const five = fallbackRowsFromStepDefs();
      nextRows = size === '5' ? five : [...five, ...fallbackRowsFromStepDefs().slice(1)];
    }
    if (nextRows.every((r) => !r.isCardSource) && nextRows.length > 0) nextRows[0].isCardSource = true;
    onChange(nextRows);
    setTemplateConfirm(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-sm text-gray-700">
          <span className="text-gray-500">Số ảnh cần chụp:</span>
          <input
            type="number"
            min={MIN_ROWS}
            max={MAX_ROWS}
            value={countDraft}
            onChange={(e) => setCountDraft(e.target.value)}
            onBlur={commitTargetCount}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-16 bg-white border border-gray-300 rounded-lg px-2 py-1 text-center font-medium text-gray-900"
          />
          <span className="font-medium">ảnh</span>
          <span className="text-gray-500"> · cần tối đa {cameraCount} camera</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTemplateConfirm('5')}
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Mẫu 5 ảnh
          </button>
          <button
            type="button"
            onClick={() => setTemplateConfirm('10')}
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Mẫu 10 ảnh
          </button>
        </div>
      </div>

      {presetsError && (
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
          Không tải được danh mục góc chụp ({presetsError}) — vẫn dùng được 5 góc mặc định.
        </div>
      )}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm border-collapse min-w-[860px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 px-2 w-10">#</th>
              <th className="py-2 px-2">Góc</th>
              <th className="py-2 px-2 w-36">Camera ưu tiên</th>
              <th className="py-2 px-2 w-56">Đánh giá (yaw / pitch)</th>
              <th className="py-2 px-2 w-16 text-center">Ảnh thẻ</th>
              <th className="py-2 px-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.key}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null || dragIndex === index) return;
                  const next = [...rows];
                  const [moved] = next.splice(dragIndex, 1);
                  next.splice(index, 0, moved);
                  onChange(next);
                  setDragIndex(null);
                }}
                className="border-b border-gray-100 align-top"
              >
                <td className="py-2 px-2 text-gray-400">
                  <div className="flex items-center gap-1">
                    <GripVertical className="w-3.5 h-3.5 cursor-grab" aria-hidden="true" />
                    <span className="tabular-nums">{index + 1}</span>
                  </div>
                  <div className="flex flex-col mt-1">
                    <button
                      type="button"
                      onClick={() => moveRow(index, -1)}
                      disabled={index === 0}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      aria-label="Đưa lên"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(index, 1)}
                      disabled={index === rows.length - 1}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      aria-label="Đưa xuống"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                <td className="py-2 px-2">
                  <input
                    value={row.label}
                    onChange={(e) => updateRow(row.key, { label: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                  />
                  <input
                    value={row.instruction}
                    onChange={(e) => updateRow(row.key, { instruction: e.target.value })}
                    placeholder="Hướng dẫn cho SV"
                    className="w-full mt-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-500"
                  />
                </td>
                <td className="py-2 px-2">
                  <select
                    value={row.cameraRole}
                    onChange={(e) => handleCameraRoleChange(row.key, e.target.value as CameraRoleName)}
                    className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                  >
                    {CAMERA_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {CAMERA_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`py-2 px-2 ${!row.confirmed ? 'ring-1 ring-amber-400 rounded-lg bg-amber-50/40' : ''}`}>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-400 w-8">yaw</span>
                    <input
                      type="number"
                      value={row.pose.yaw?.target ?? 0}
                      onChange={(e) => updatePoseAxis(row.key, 'yaw', 'target', Number(e.target.value))}
                      className="w-14 bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900"
                    />
                    <span className="text-gray-400">±</span>
                    <input
                      type="number"
                      value={row.pose.yaw?.tolerance ?? 10}
                      onChange={(e) => updatePoseAxis(row.key, 'yaw', 'tolerance', Number(e.target.value))}
                      className="w-12 bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-xs mt-1">
                    <span className="text-gray-400 w-8">pitch</span>
                    <input
                      type="number"
                      value={row.pose.pitch?.target ?? 0}
                      onChange={(e) => updatePoseAxis(row.key, 'pitch', 'target', Number(e.target.value))}
                      className="w-14 bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900"
                    />
                    <span className="text-gray-400">±</span>
                    <input
                      type="number"
                      value={row.pose.pitch?.tolerance ?? 10}
                      onChange={(e) => updatePoseAxis(row.key, 'pitch', 'tolerance', Number(e.target.value))}
                      className="w-12 bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900"
                    />
                  </div>
                  {!row.confirmed && <div className="text-[11px] text-amber-600 mt-1">Xác nhận độ chính xác</div>}
                </td>
                <td className="py-2 px-2 text-center">
                  <input
                    type="radio"
                    name="card-source"
                    checked={row.isCardSource}
                    onChange={() => setCardSource(row.key)}
                    className="mt-1"
                  />
                </td>
                <td className="py-2 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length <= MIN_ROWS}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-30"
                    aria-label="Xóa góc"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-gray-400">
                  Chưa có góc chụp nào — thêm từ danh mục hoặc dùng một mẫu có sẵn.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={atMax}
          className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 font-medium disabled:opacity-40"
        >
          + Thêm góc từ danh mục
        </button>
        {belowMin && <span className="text-red-600 font-medium">Cần tối thiểu {MIN_ROWS} góc chụp</span>}
        {atMax && <span className="text-gray-500">Đã đạt tối đa {MAX_ROWS} góc</span>}
        {cardSourceCount !== 1 && rows.length > 0 && (
          <span className="text-red-600 font-medium">Phải chọn đúng 1 dòng làm ảnh thẻ</span>
        )}
      </div>

      {pickerOpen && (
        <AnglePickerModal
          presets={presets}
          error={presetsError}
          onClose={() => setPickerOpen(false)}
          onPick={addFromPreset}
        />
      )}

      {templateConfirm && (
        <ModalShell title={`Áp dụng mẫu ${templateConfirm} ảnh`} onClose={() => setTemplateConfirm(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">
              Thao tác này sẽ <strong>thay toàn bộ {rows.length} dòng hiện tại</strong> bằng mẫu {templateConfirm} ảnh.
              Không thể hoàn tác trong form này.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTemplateConfirm(null)}
                className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => applyTemplate(templateConfirm)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/** Angle-catalog picker (C2.2's "Thêm góc từ danh mục") — reads `GET /v1/capture-angle-presets`, same list `AnglePresetsPage` (C3) manages. */
function AnglePickerModal({
  presets,
  error,
  onClose,
  onPick,
}: {
  presets: CaptureAnglePreset[] | null;
  error: string | null;
  onClose: () => void;
  onPick: (preset: CaptureAnglePreset) => void;
}) {
  return (
    <ModalShell title="Thêm góc từ danh mục" onClose={onClose}>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            Không tải được danh mục góc chụp: {error}
          </div>
        )}
        {!presets && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}
        {presets && presets.length === 0 && (
          <p className="text-gray-500 text-sm">Chưa có góc chụp nào trong danh mục — tạo ở trang "Góc chụp".</p>
        )}
        {presets?.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPick(preset)}
            className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-gray-50 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{preset.labelVi}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {preset.code} · {CAMERA_ROLE_LABELS[preset.preferredCameraRole]}
                {preset.poseDefault.yaw && ` · yaw ${preset.poseDefault.yaw.target}±${preset.poseDefault.yaw.tolerance}`}
              </div>
            </div>
            <span className="text-gray-400 shrink-0">Chọn →</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
