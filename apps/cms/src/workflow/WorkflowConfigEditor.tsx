import { useState } from 'react';
import {
  CardSpec,
  IdentificationMethod,
  WorkflowClickMode,
  WorkflowConfig,
} from '../api';
import { CaptureAngleRow, captureStepToRow, rowToCaptureStep } from '../captureAngleSteps';
import { CaptureAnglesTable } from '../components/CaptureAnglesTable';
import { CardSpecFields } from '../components/CardSpecFields';

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
 * `config.aiProcessing`'s real shape stays `{enabled, steps: [{code, params}]}`
 * server-side (`workflow-config.schema.ts`, unchanged) — nothing reads this
 * config to actually run AI yet (confirmed 2026-09-18: grepped `apps/api`
 * for any consumer of `config.aiProcessing`, found only the zod schema and
 * a migration seeding an empty default; the `ai_pipeline_steps` catalog
 * table exists but nothing queries it either). Per product feedback the
 * same day ("chỉ để điền thông tin prompt, không cần thiết kế phức tạp" —
 * the multi-step/JSON-params editor this replaced was overbuilt for a
 * config with no real consumer), the CMS now only ever writes AT MOST one
 * implicit step here, fixed `code: 'PROMPT'`, holding a single free-text
 * `params.prompt` — see `AI_PROMPT_STEP_CODE`/`aiPrompt` below. The step
 * shape itself is untouched so a later real pipeline can still add proper
 * multi-step support without a schema migration.
 */
interface AiProcessingStep {
  code: string;
  params?: Record<string, unknown>;
}
interface AiProcessingConfigShape {
  enabled: boolean;
  steps: AiProcessingStep[];
}

const AI_PROMPT_STEP_CODE = 'PROMPT';

/**
 * Structured editor for a workflow draft version's `config`. `capture`
 * (angles + click mode) and `output` (photo kind + card spec) reuse the
 * `CaptureAnglesTable`/`CardSpecFields` components — removed from the
 * raw-JSON groups as of plan item 6, 2026-09-17. `printing` got its own
 * structured editor as of plan item E.1, 2026-09-17 (`PrintingConfigShape`
 * above): a single DIRECT/CENTRALIZED `<select>`. `aiProcessing` got a
 * structured editor the same day, then was simplified further 2026-09-18
 * (see `AiProcessingConfigShape`'s own doc comment) down to an enabled
 * checkbox plus one prompt textarea. This is now the ONLY place any of
 * these 5 config groups gets authored: the older, separate "Mẫu chụp"
 * (`CaptureConfigurationsPage.tsx`) picker this used to duplicate was
 * retired the same day (see `CampaignForm.tsx`'s own doc comment).
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
}: {
  config: WorkflowConfig;
  onChange: (next: WorkflowConfig) => void;
  identificationMethods: IdentificationMethod[];
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

  const aiProcessing = (config.aiProcessing as unknown as Partial<AiProcessingConfigShape>) ?? {};
  const aiEnabled = aiProcessing.enabled ?? false;
  const aiPrompt = (aiProcessing.steps?.[0]?.params?.prompt as string | undefined) ?? '';

  function updateAiProcessing(patch: Partial<AiProcessingConfigShape>) {
    onChange({ ...config, aiProcessing: { ...aiProcessing, ...patch } });
  }

  function updateAiPrompt(prompt: string) {
    updateAiProcessing({
      steps: prompt ? [{ code: AI_PROMPT_STEP_CODE, params: { prompt } }] : [],
    });
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
          <label className="block text-sm text-gray-500 mb-1">Mã loại ảnh (photo kind)</label>
          <input
            value={config.output.photoKindCode}
            onChange={(e) => updateOutput({ photoKindCode: e.target.value })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        <CardSpecFields
          cardSpec={config.output.cardSpec}
          onChange={(updater) => updateOutput({ cardSpec: updater(config.output.cardSpec as CardSpec) })}
        />
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

      <section className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Xử lý AI (aiProcessing)</h3>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => updateAiProcessing({ enabled: e.target.checked })}
            className="rounded border-gray-300"
          />
          Bật xử lý AI
        </label>
        {aiEnabled && (
          <div>
            <label className="block text-sm text-gray-500 mb-1">Prompt</label>
            <textarea
              value={aiPrompt}
              onChange={(e) => updateAiPrompt(e.target.value)}
              rows={3}
              placeholder="Mô tả yêu cầu chỉnh sửa ảnh bằng AI..."
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        )}
      </section>
    </div>
  );
}
