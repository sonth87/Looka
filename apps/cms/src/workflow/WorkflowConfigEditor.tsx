import { useEffect, useState } from 'react';
import {
  ApiError,
  Campaign,
  CardSpec,
  EligibilityApiAuthType,
  EligibilityApiRequestMethod,
  IdentificationMethod,
  WorkflowClickMode,
  WorkflowConfig,
  WorkflowConfigEligibility,
  WorkflowConfigEligibilityApi,
  WorkflowConfigEligibilityRule,
  listCampaigns,
  testEligibilityLookup,
  testRosterLookup,
} from '../api';
import { CaptureAngleRow, captureStepToRow, rowToCaptureStep } from '../captureAngleSteps';
import { CaptureAnglesTable } from '../components/CaptureAnglesTable';
import { CardSpecFields } from '../components/CardSpecFields';

const ELIGIBILITY_MODE_LABEL: Record<WorkflowConfigEligibility['mode'], string> = {
  NONE: 'Không kiểm tra (ai cũng chụp được)',
  ROSTER: 'Theo danh sách roster đã nạp',
  EXTERNAL_API: 'Theo API ngoài',
  ROSTER_AND_API: 'Roster + API ngoài',
};

const ELIGIBILITY_AUTH_TYPE_LABEL: Record<EligibilityApiAuthType, string> = {
  NONE: 'Không cần xác thực',
  API_KEY_HEADER: 'API key qua header',
  BEARER_TOKEN: 'Bearer token',
  QUERY_PARAM: 'Key qua query param',
};

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

/** `config.aiProcessing`'s real shape — same "cast locally, don't widen `api.ts`" note as `PrintingConfigShape` above. `params` stays a genuinely open per-step object (no fixed shape across step `code`s), so it alone is still edited as scoped-down raw JSON. */
interface AiProcessingStep {
  code: string;
  params?: Record<string, unknown>;
}
interface AiProcessingConfigShape {
  enabled: boolean;
  steps: AiProcessingStep[];
}

/**
 * Structured editor for a workflow draft version's `config`. `capture`
 * (angles + click mode) and `output` (photo kind + card spec) reuse the
 * `CaptureAnglesTable`/`CardSpecFields` components — removed from the
 * raw-JSON groups as of plan item 6, 2026-09-17. `aiProcessing`/`printing`
 * got their own structured editors as of plan item E.1, 2026-09-17
 * (`PrintingConfigShape`/`AiProcessingConfigShape` above): `printing` is a
 * single DIRECT/CENTRALIZED `<select>`, `aiProcessing` is an enabled
 * checkbox plus an add/remove-able `steps` list. Only each AI step's own
 * `params` object stays raw JSON, scoped to that one row — it's genuinely
 * open-ended per step `code` (RETOUCH/BACKGROUND_REMOVE/…), unlike the rest
 * of either group which now has a fixed shape. This is now the ONLY place
 * any of these 6 config groups gets authored: the older, separate "Mẫu
 * chụp" (`CaptureConfigurationsPage.tsx`) picker this used to duplicate was
 * retired the same day (see `CampaignForm.tsx`'s own doc comment).
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

  function updateEligibility(patch: Partial<WorkflowConfigEligibility>) {
    onChange({ ...config, eligibility: { ...config.eligibility, ...patch } });
  }

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
  const aiSteps = aiProcessing.steps ?? [];

  function updateAiProcessing(patch: Partial<AiProcessingConfigShape>) {
    onChange({ ...config, aiProcessing: { ...aiProcessing, ...patch } });
  }

  const needsApi = config.eligibility.mode === 'EXTERNAL_API' || config.eligibility.mode === 'ROSTER_AND_API';
  const needsRoster = config.eligibility.mode === 'ROSTER' || config.eligibility.mode === 'ROSTER_AND_API';

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
        <h3 className="text-sm font-semibold text-gray-900">Điều kiện tiếp nhận (eligibility)</h3>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Chế độ</label>
          <select
            value={config.eligibility.mode}
            onChange={(e) => updateEligibility({ mode: e.target.value as WorkflowConfigEligibility['mode'] })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {(Object.keys(ELIGIBILITY_MODE_LABEL) as WorkflowConfigEligibility['mode'][]).map((mode) => (
              <option key={mode} value={mode}>
                {ELIGIBILITY_MODE_LABEL[mode]}
              </option>
            ))}
          </select>
        </div>

        {needsRoster && (
          <div>
            <label className="block text-sm text-gray-500 mb-1">Mẫu roster (tuỳ chọn)</label>
            <input
              value={config.eligibility.rosterTemplate ?? ''}
              onChange={(e) => updateEligibility({ rosterTemplate: e.target.value || undefined })}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        )}

        {needsApi && (
          <EligibilityApiFields eligibility={config.eligibility} onChange={updateEligibility} />
        )}

        <EligibilityRulesEditor
          rules={config.eligibility.rules ?? []}
          onChange={(rules) => updateEligibility({ rules })}
        />

        {needsRoster && <EligibilityRosterTestFields rules={config.eligibility.rules ?? []} />}
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
          <AiProcessingStepsEditor steps={aiSteps} onChange={(steps) => updateAiProcessing({ steps })} />
        )}
      </section>
    </div>
  );
}

const ELIGIBILITY_REQUEST_METHODS: EligibilityApiRequestMethod[] = ['POST', 'GET'];
const DEFAULT_ELIGIBILITY_API: WorkflowConfigEligibilityApi = {
  baseUrl: '',
  requestMethod: 'POST',
  requestPath: '',
  authType: 'API_KEY_HEADER',
};

/**
 * Inline per-workflow API config (2026-09-17 redo of plan item 7 — no more
 * "pick a client from a shared catalog" dropdown; every field the API call
 * needs is entered directly here, saved as part of THIS workflow's own
 * `config.eligibility.api`). `discoveredFields` is local-only state: the
 * choices for "field bắt buộc phải khớp" come from whatever the last test
 * call's response actually contained (plus any fields already selected in
 * a previously-saved config, so those don't disappear just because this
 * editing session hasn't test-called yet) — nothing is persisted server-side
 * beyond the config itself.
 */
function EligibilityApiFields({
  eligibility,
  onChange,
}: {
  eligibility: WorkflowConfigEligibility;
  onChange: (patch: Partial<WorkflowConfigEligibility>) => void;
}) {
  const api = eligibility.api ?? DEFAULT_ELIGIBILITY_API;
  const [bodyTemplateText, setBodyTemplateText] = useState(
    JSON.stringify(api.requestBodyTemplate ?? { key: '{{key}}' }, null, 2),
  );
  const [bodyTemplateError, setBodyTemplateError] = useState<string | null>(null);
  const [discoveredFields, setDiscoveredFields] = useState<string[]>(api.requiredFields ?? []);

  const [testKey, setTestKey] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  function updateApi(patch: Partial<WorkflowConfigEligibilityApi>) {
    onChange({ api: { ...api, ...patch } });
  }

  function updateBodyTemplateText(text: string) {
    setBodyTemplateText(text);
    try {
      const parsed = JSON.parse(text);
      setBodyTemplateError(null);
      updateApi({ requestBodyTemplate: parsed });
    } catch {
      setBodyTemplateError('JSON không hợp lệ — chưa áp dụng thay đổi này');
    }
  }

  async function runTest() {
    if (!api.baseUrl.trim() || !api.requestPath.trim() || !testKey.trim()) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testEligibilityLookup(api, testKey.trim());
      setTestResult(result.success ? JSON.stringify(result.sampleRecord, null, 2) : result.message ?? 'Không tìm thấy.');
      if (result.sampleRecord) {
        setDiscoveredFields((prev) => Array.from(new Set([...prev, ...Object.keys(result.sampleRecord!)])));
      }
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="pl-3 border-l-2 border-gray-200 space-y-3">
      <div>
        <label className="block text-sm text-gray-500 mb-1">Base URL</label>
        <input
          value={api.baseUrl}
          onChange={(e) => updateApi({ baseUrl: e.target.value })}
          placeholder="https://openapi.dainam.edu.vn"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>

      <div className="grid grid-cols-[100px_1fr] gap-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Method</label>
          <select
            value={api.requestMethod}
            onChange={(e) => updateApi({ requestMethod: e.target.value as EligibilityApiRequestMethod })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {ELIGIBILITY_REQUEST_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Path</label>
          <input
            value={api.requestPath}
            onChange={(e) => updateApi({ requestPath: e.target.value })}
            placeholder="/api/get_list_student_info"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-500 mb-1">
          {api.requestMethod === 'GET' ? 'Query params' : 'Thân request'} (JSON — chuỗi "{'{{key}}'}" sẽ được thay bằng mã tra cứu)
        </label>
        <textarea
          value={bodyTemplateText}
          onChange={(e) => updateBodyTemplateText(e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 font-mono text-xs"
        />
        {bodyTemplateError && <p className="text-xs text-red-600 mt-1">{bodyTemplateError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Xác thực</label>
          <select
            value={api.authType}
            onChange={(e) => updateApi({ authType: e.target.value as EligibilityApiAuthType })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          >
            {(Object.keys(ELIGIBILITY_AUTH_TYPE_LABEL) as EligibilityApiAuthType[]).map((t) => (
              <option key={t} value={t}>
                {ELIGIBILITY_AUTH_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {api.authType !== 'NONE' && (
          <div>
            <label className="block text-sm text-gray-500 mb-1">Tên header/query param</label>
            <input
              value={api.authParamName ?? ''}
              onChange={(e) => updateApi({ authParamName: e.target.value })}
              placeholder="x-api-key"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        )}
      </div>

      {api.authType !== 'NONE' && (
        <div>
          <label className="block text-sm text-gray-500 mb-1">
            API key / access token
            {api.hasCredential && ' (đã có sẵn — bỏ trống để giữ nguyên)'}
          </label>
          <input
            type="password"
            value={api.credential ?? ''}
            onChange={(e) => updateApi({ credential: e.target.value })}
            placeholder={api.hasCredential ? '••••••••' : 'Nhập credential'}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
      )}

      <div>
        <label className="block text-sm text-gray-500 mb-1">Đường dẫn field khoá trong response (tuỳ chọn)</label>
        <input
          value={api.keyResponsePath ?? ''}
          onChange={(e) => updateApi({ keyResponsePath: e.target.value })}
          placeholder="data[0].student_code"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 font-mono text-xs"
        />
      </div>

      {discoveredFields.length > 0 && (
        <div>
          <label className="block text-sm text-gray-500 mb-1">Field bắt buộc phải khớp (tuỳ chọn)</label>
          <div className="flex flex-wrap gap-2">
            {discoveredFields.map((f) => {
              const checked = (api.requiredFields ?? []).includes(f);
              return (
                <label key={f} className="flex items-center gap-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-full px-2 py-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = api.requiredFields ?? [];
                      const next = e.target.checked ? [...current, f] : current.filter((x) => x !== f);
                      updateApi({ requiredFields: next });
                    }}
                    className="rounded border-gray-300"
                  />
                  {f}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
        <label className="block text-xs text-blue-800">
          Thử tra cứu 1 mã thật để xem field trả về (dùng cấu hình đang nhập, chưa cần lưu workflow)
        </label>
        <div className="flex gap-2">
          <input
            value={testKey}
            onChange={(e) => setTestKey(e.target.value)}
            placeholder="Nhập mã để thử..."
            className="flex-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
          />
          <button
            type="button"
            disabled={testBusy || !testKey.trim() || !api.baseUrl.trim() || !api.requestPath.trim()}
            onClick={() => void runTest()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
          >
            Thử
          </button>
        </div>
        {testError && <p className="text-xs text-red-600">{testError}</p>}
        {testResult && <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-40">{testResult}</pre>}
      </div>
    </div>
  );
}

/**
 * "Kiểm tra theo dữ liệu đã import" (plan item E.3, 2026-09-17) — ROSTER/
 * ROSTER_AND_API's own test tool, mirroring `EligibilityApiFields`'s "Thử"
 * UX above: calls `testRosterLookup` with the campaign picked here plus the
 * `rules` from the IN-PROGRESS form (not yet saved) — nothing needs saving
 * first. Loads the campaign list once on mount for the picker; everything
 * else is local, throwaway test state, same as `EligibilityApiFields`'s
 * `testKey`/`testBusy`/`testResult`/`testError`.
 */
function EligibilityRosterTestFields({ rules }: { rules: WorkflowConfigEligibilityRule[] }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [testKey, setTestKey] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testEligible, setTestEligible] = useState<boolean | null>(null);
  const [testReason, setTestReason] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch(() => setCampaigns([]));
  }, []);

  async function runTest() {
    if (!campaignId || !testKey.trim()) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    setTestEligible(null);
    setTestReason(null);
    try {
      const result = await testRosterLookup(campaignId, testKey.trim(), rules);
      setTestEligible(result.eligible);
      setTestReason(result.reason ?? null);
      setTestResult(result.found ? JSON.stringify(result.subject, null, 2) : 'Không tìm thấy trong danh sách đã import.');
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
      <label className="block text-xs text-blue-800">
        Kiểm tra theo dữ liệu đã import (dùng roster + điều kiện đang nhập ở trên, chưa cần lưu workflow)
      </label>
      <select
        value={campaignId}
        onChange={(e) => setCampaignId(e.target.value)}
        className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
      >
        <option value="">-- Chọn campaign --</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.code ? ` (${c.code})` : ''}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          value={testKey}
          onChange={(e) => setTestKey(e.target.value)}
          placeholder="Mã SV/CCCD..."
          className="flex-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
        />
        <button
          type="button"
          disabled={testBusy || !campaignId || !testKey.trim()}
          onClick={() => void runTest()}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
        >
          Thử
        </button>
      </div>
      {testEligible !== null && (
        <p className={`text-xs font-medium ${testEligible ? 'text-green-700' : 'text-amber-700'}`}>
          {testEligible ? 'Đủ điều kiện' : 'Không đủ điều kiện'}
          {testReason ? ` — ${testReason}` : ''}
        </p>
      )}
      {testError && <p className="text-xs text-red-600">{testError}</p>}
      {testResult && <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-40">{testResult}</pre>}
    </div>
  );
}

function EligibilityRulesEditor({
  rules,
  onChange,
}: {
  rules: WorkflowConfigEligibilityRule[];
  onChange: (rules: WorkflowConfigEligibilityRule[]) => void;
}) {
  function updateRule(index: number, patch: Partial<WorkflowConfigEligibilityRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }
  function addRule() {
    onChange([...rules, { key: '', expr: '', message: '' }]);
  }

  return (
    <div>
      <label className="block text-sm text-gray-500 mb-1.5">Điều kiện bổ sung (rules)</label>
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
            <input
              value={rule.key}
              onChange={(e) => updateRule(i, { key: e.target.value })}
              placeholder="key"
              className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900"
            />
            <input
              value={rule.expr}
              onChange={(e) => updateRule(i, { expr: e.target.value })}
              placeholder="biểu thức"
              className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 font-mono"
            />
            <input
              value={rule.message}
              onChange={(e) => updateRule(i, { message: e.target.value })}
              placeholder="thông báo khi không đạt"
              className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900"
            />
            <button type="button" onClick={() => removeRule(i)} className="text-red-600 hover:text-red-800 text-xs font-medium px-1">
              Xoá
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRule} className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
        + Thêm điều kiện
      </button>
    </div>
  );
}

interface AiProcessingStepDraft {
  code: string;
  paramsText: string;
  params: Record<string, unknown> | undefined;
  paramsError: string | null;
}

function stepToDraft(step: AiProcessingStep): AiProcessingStepDraft {
  return { code: step.code, paramsText: JSON.stringify(step.params ?? {}, null, 2), params: step.params, paramsError: null };
}

/**
 * `aiProcessing.steps` list editor (plan item E.1, 2026-09-17) — one-time
 * copy of `steps` into local `drafts` state, same convention
 * `WorkflowConfigEditor`'s own `captureRows` uses above: this component is
 * the sole owner of edits to the list from here on (toggling "Bật xử lý
 * AI" off unmounts it, so no resync effect is needed on remount either).
 * Each row's `code` is a plain text input applied immediately; `params`
 * stays its own JSON textarea scoped to just that row (mirrors
 * `EligibilityApiFields`'s `bodyTemplateText` pattern below) — invalid JSON
 * stays visible for editing but is NOT applied upward until it parses.
 */
function AiProcessingStepsEditor({
  steps,
  onChange,
}: {
  steps: AiProcessingStep[];
  onChange: (steps: AiProcessingStep[]) => void;
}) {
  const [drafts, setDrafts] = useState<AiProcessingStepDraft[]>(() => steps.map(stepToDraft));

  function commit(next: AiProcessingStepDraft[]) {
    setDrafts(next);
    onChange(next.map((d) => ({ code: d.code, params: d.params })));
  }

  function updateCode(index: number, code: string) {
    commit(drafts.map((d, i) => (i === index ? { ...d, code } : d)));
  }

  function updateParamsText(index: number, text: string) {
    try {
      const parsed = JSON.parse(text);
      commit(drafts.map((d, i) => (i === index ? { ...d, paramsText: text, params: parsed, paramsError: null } : d)));
    } catch {
      setDrafts(
        drafts.map((d, i) =>
          i === index ? { ...d, paramsText: text, paramsError: 'JSON không hợp lệ — chưa áp dụng thay đổi này' } : d,
        ),
      );
    }
  }

  function removeStep(index: number) {
    commit(drafts.filter((_, i) => i !== index));
  }

  function addStep() {
    commit([...drafts, { code: '', paramsText: '{}', params: {}, paramsError: null }]);
  }

  return (
    <div>
      <label className="block text-sm text-gray-500 mb-1.5">Các bước xử lý (steps)</label>
      <div className="space-y-2">
        {drafts.map((draft, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-1.5 items-start p-2 rounded-lg bg-gray-50 border border-gray-200">
            <input
              value={draft.code}
              onChange={(e) => updateCode(i, e.target.value)}
              placeholder="Mã bước (RETOUCH, BACKGROUND_REMOVE...)"
              className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900"
            />
            <div>
              <textarea
                value={draft.paramsText}
                onChange={(e) => updateParamsText(i, e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="params (JSON)"
                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 font-mono"
              />
              {draft.paramsError && <p className="text-xs text-red-600 mt-0.5">{draft.paramsError}</p>}
            </div>
            <button type="button" onClick={() => removeStep(i)} className="text-red-600 hover:text-red-800 text-xs font-medium px-1">
              Xoá
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addStep} className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
        + Thêm bước
      </button>
    </div>
  );
}
