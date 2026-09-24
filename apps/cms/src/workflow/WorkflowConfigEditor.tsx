import { useState } from 'react';
import {
  IdentificationMethod,
  PhotoKind,
  WorkflowClickMode,
  WorkflowConfig,
} from '../api';
import { CaptureAngleRow, captureStepToRow, rowToCaptureStep } from '../captureAngleSteps';
import { CaptureAnglesTable } from '../components/CaptureAnglesTable';

const CLICK_MODE_LABEL: Record<WorkflowClickMode, string> = {
  MANUAL_SEQUENTIAL: 'Bấm chụp lần lượt từng cam',
  MANUAL_ALL_AT_ONCE: 'Bấm chụp toàn bộ 1 lần',
  AUTO_AI: 'Tự động (AI quyết định thời điểm chụp)',
};
const CLICK_MODES = Object.keys(CLICK_MODE_LABEL) as WorkflowClickMode[];

type PrintingMode = 'DIRECT' | 'CENTRALIZED';
const PRINTING_MODE_LABEL: Record<PrintingMode, string> = {
  DIRECT: 'In trực tiếp tại kiosk (DIRECT)',
  CENTRALIZED: 'In tập trung — CMS gom lệnh in (CENTRALIZED)',
};

/** `config.printing`'s real shape — `WorkflowConfig.printing` stays `Record<string, unknown>` at the `api.ts` type level (that file's own change is scoped to just `testRosterLookup` this pass), so this component casts locally instead of widening the shared type. */
interface PrintingConfigShape {
  mode: PrintingMode;
}

/**
 * Structured editor for a workflow draft version's `config`. `capture`
 * (angles + click mode) reuses the `CaptureAnglesTable` component —
 * removed from the raw-JSON groups as of plan item 6, 2026-09-17. `output`
 * (photo kind + card spec) picks a Photo Kind from `/photo-kinds`'
 * catalog (2026-09-22) rather than re-entering `cardSpec` by hand — see
 * this file's own "Đầu ra / ảnh thẻ" section for why. `printing` got its own
 * structured editor as of plan item E.1, 2026-09-17 (`PrintingConfigShape`
 * above): a single DIRECT/CENTRALIZED `<select>`.
 *
 * `aiProcessing` had a structured editor here too (an enabled checkbox +
 * one prompt textarea) until 2026-09-22, removed per product feedback
 * ("chế độ AI chuyển sang phần cấu hình bên workflow không cần nữa") —
 * it never had a real backend consumer to begin with (confirmed
 * 2026-09-18: grepped `apps/api` for any reader of `config.aiProcessing`,
 * found only the zod schema and a migration seeding an empty default),
 * and the actually-used AI-edit prompt config lives on `PhotoKind.
 * promptHints` (`/photo-kinds`) instead — a different, already-real
 * feature. `config.aiProcessing` itself still exists on `WorkflowConfig`
 * (server schema requires the field) — this component just passes
 * whatever value it already had straight through, unedited.
 *
 * This is now the ONLY place any of these 4 config groups gets authored:
 * the older, separate "Mẫu chụp" (`CaptureConfigurationsPage.tsx`) picker
 * this used to duplicate was retired 2026-09-17 (see `CampaignForm.tsx`'s
 * own doc comment).
 *
 * "Điều kiện tiếp nhận" (eligibility) used to be a 6th group edited here —
 * moved OFF this component entirely, later the same day (2026-09-18,
 * product feedback: "mục Điều kiện tiếp nhận... không cần ở màn tạo
 * workflow nữa, thông tin đó sẽ được config trong phần campaign"). See
 * `apps/cms/src/api.ts`'s `EligibilityConfig` section header comment and
 * `EligibilityConfigEditor.tsx` (now wired into `CampaignForm.tsx` instead)
 * for where that editing UI lives now.
 *
 * Fully controlled (`config`/`onChange`) — this component holds no server
 * state itself; the caller (`WorkflowsPage.tsx`) owns save/validate/publish.
 */
export function WorkflowConfigEditor({
  config,
  onChange,
  identificationMethods,
  photoKinds,
}: {
  config: WorkflowConfig;
  onChange: (next: WorkflowConfig) => void;
  identificationMethods: IdentificationMethod[];
  photoKinds: PhotoKind[];
}) {
  // One-time-copy convention for `CaptureAnglesTable`'s own row state —
  // `config` only ever changes by remount
  // here (switching workflows closes/reopens `WorkflowDetailModal`), so no
  // resync effect is needed.
  const [captureRows, setCaptureRows] = useState<CaptureAngleRow[]>(() => config.capture.angles.map(captureStepToRow));

  function updateCaptureRows(rows: CaptureAngleRow[]) {
    setCaptureRows(rows);
    onChange({ ...config, capture: { ...config.capture, angles: rows.map((row, i) => rowToCaptureStep(row, i)) } });
  }

  function updateClickMode(patch: Partial<WorkflowConfig['capture']['clickMode']>) {
    onChange({ ...config, capture: { ...config.capture, clickMode: { ...config.capture.clickMode, ...patch } } });
  }

  function updateOutput(patch: Partial<WorkflowConfig['output']>) {
    onChange({ ...config, output: { ...config.output, ...patch } });
  }

  const printing = (config.printing as unknown as Partial<PrintingConfigShape>) ?? {};
  const printingMode: PrintingMode = printing.mode ?? 'DIRECT';

  function updatePrinting(patch: Partial<PrintingConfigShape>) {
    onChange({ ...config, printing: { ...printing, ...patch } });
  }

  return (
    <div className="space-y-5">
      <section className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Chụp ảnh (capture)</h3>

        <CaptureAnglesTable rows={captureRows} onChange={updateCaptureRows} />

        <div>
          <label className="block text-sm text-gray-500 mb-1">Chế độ bấm chụp mặc định</label>
          <select
            value={config.capture.clickMode.default}
            onChange={(e) => {
              const next = e.target.value as WorkflowClickMode;
              const allowed = config.capture.clickMode.allowed.includes(next)
                ? config.capture.clickMode.allowed
                : [...config.capture.clickMode.allowed, next];
              updateClickMode({ default: next, allowed });
            }}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {CLICK_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {CLICK_MODE_LABEL[mode]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1.5">Chế độ được kiosk chọn trong đó</label>
          <div className="flex flex-wrap gap-3">
            {CLICK_MODES.map((mode) => {
              const checked = config.capture.clickMode.allowed.includes(mode);
              return (
                <label key={mode} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={mode === config.capture.clickMode.default}
                    onChange={(e) => {
                      const allowed = e.target.checked
                        ? [...config.capture.clickMode.allowed, mode]
                        : config.capture.clickMode.allowed.filter((m) => m !== mode);
                      updateClickMode({ allowed });
                    }}
                    className="rounded border-gray-300"
                  />
                  {CLICK_MODE_LABEL[mode]}
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <section className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Phương thức định danh (identification)</h3>
        <div className="space-y-1.5">
          {identificationMethods.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={config.identification.methods.includes(m.code)}
                onChange={(e) => {
                  const methods = e.target.checked
                    ? [...config.identification.methods, m.code]
                    : config.identification.methods.filter((code) => code !== m.code);
                  onChange({ ...config, identification: { ...config.identification, methods } });
                }}
                className="rounded border-gray-300"
              />
              {m.nameVi} <span className="text-gray-400">({m.code})</span>
              {!m.active && <span className="text-amber-600 text-xs">— đã tắt</span>}
            </label>
          ))}
          {identificationMethods.length === 0 && (
            <p className="text-xs text-gray-400">Chưa có phương thức nào trong danh mục — thêm ở trang "Phương thức định danh".</p>
          )}
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Trường dùng để tra cứu</label>
          <select
            value={config.identification.lookupKeyField}
            onChange={(e) =>
              onChange({ ...config, identification: { ...config.identification, lookupKeyField: e.target.value as 'citizenId' | 'studentCode' } })
            }
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="citizenId">Số CCCD</option>
            <option value="studentCode">Mã sinh viên</option>
          </select>
        </div>
      </section>

      <section className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Đầu ra / ảnh thẻ (output)</h3>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Loại ảnh (photo kind)</label>
          <select
            value={config.output.photoKindCode}
            onChange={(e) => {
              const kind = photoKinds.find((k) => k.code === e.target.value);
              if (!kind) return;
              updateOutput({ photoKindCode: kind.code, cardSpec: kind.cardSpec });
            }}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            <option value="">— Chọn loại ảnh —</option>
            {!photoKinds.some((k) => k.code === config.output.photoKindCode) && config.output.photoKindCode && (
              <option value={config.output.photoKindCode}>{config.output.photoKindCode} (không còn trong danh mục)</option>
            )}
            {photoKinds.map((k) => (
              <option key={k.code} value={k.code}>
                {k.labelVi} ({k.code}){!k.active ? ' — đã tắt' : ''}
              </option>
            ))}
          </select>
          {photoKinds.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">Chưa có loại ảnh nào trong danh mục — thêm ở trang "Loại ảnh".</p>
          )}
        </div>

        {/*
          2026-09-22 fix: cardSpec (cỡ/dpi/màu nền/tỉ lệ/làm mịn) is no
          longer entered here at all — it comes entirely from the picked
          Photo Kind's own catalog entry (`/photo-kinds`, `PhotoKind.cardSpec`
          — already the full shape this section used to duplicate manual
          inputs for). Read-only summary only, so an admin can see what
          they're about to save without re-entering it; to change these
          values, edit the Photo Kind itself, which then applies to every
          workflow using that kind.
        */}
        {config.output.cardSpec && (
          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700 space-y-1">
            <p className="text-xs text-gray-500">
              Cấu hình thẻ áp dụng từ loại ảnh đã chọn (sửa ở trang "Loại ảnh" nếu cần đổi):
            </p>
            <p>
              Cỡ ảnh: <span className="font-medium">{config.output.cardSpec.size ?? '—'} cm</span> · DPI:{' '}
              <span className="font-medium">{config.output.cardSpec.dpi ?? '—'}</span> · Màu nền:{' '}
              <span className="inline-flex items-center gap-1 align-middle">
                <span
                  className="inline-block w-3.5 h-3.5 rounded border border-gray-300 align-middle"
                  style={{ backgroundColor: config.output.cardSpec.backgroundColor ?? '#FFFFFF' }}
                />
                <span className="font-mono text-xs">{config.output.cardSpec.backgroundColor ?? '—'}</span>
              </span>
            </p>
            <p>
              Tỉ lệ chiều cao đầu:{' '}
              <span className="font-medium">
                {config.output.cardSpec.headHeightRatio?.[0] ?? '—'}–{config.output.cardSpec.headHeightRatio?.[1] ?? '—'}
              </span>{' '}
              · Tỉ lệ đường mắt:{' '}
              <span className="font-medium">
                {config.output.cardSpec.eyeLineRatio?.[0] ?? '—'}–{config.output.cardSpec.eyeLineRatio?.[1] ?? '—'}
              </span>{' '}
              · Làm mịn:{' '}
              <span className="font-medium">
                {config.output.cardSpec.retouch?.enabled ? config.output.cardSpec.retouch.strength ?? 'LIGHT' : 'Tắt'}
              </span>
            </p>
          </div>
        )}
      </section>

      <section className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">In ấn (printing)</h3>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Chế độ in</label>
          <select
            value={printingMode}
            onChange={(e) => updatePrinting({ mode: e.target.value as PrintingMode })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {(Object.keys(PRINTING_MODE_LABEL) as PrintingMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {PRINTING_MODE_LABEL[mode]}
              </option>
            ))}
          </select>
        </div>
      </section>

    </div>
  );
}
