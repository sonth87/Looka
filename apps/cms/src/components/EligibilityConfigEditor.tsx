import { useState } from 'react';
import {
  ApiError,
  EligibilityApiAuthType,
  EligibilityApiConfig,
  EligibilityApiRequestMethod,
  EligibilityConfig,
  EligibilityRuleConfig,
  downloadRosterImportTemplate,
  testEligibilityLookup,
  testRosterLookup,
} from '../api';

const ELIGIBILITY_MODE_LABEL: Record<EligibilityConfig['mode'], string> = {
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

/**
 * "Điều kiện tiếp nhận" (eligibility) editor — mode + inline API config +
 * rules + roster format reference. 2026-09-18: moved here from
 * `WorkflowConfigEditor.tsx` (see that file's git history and
 * `apps/cms/src/api.ts`'s `EligibilityConfig` section header comment) now
 * that eligibility is campaign-scoped, not workflow-scoped. Fully
 * controlled (`eligibility`/`onChange`), same convention
 * `WorkflowConfigEditor` used — the caller (`CampaignForm.tsx`) owns save.
 *
 * `campaignId` is `null` while creating a brand new campaign (nothing to
 * test-call a roster lookup against yet, and no roster upload page exists
 * until the campaign itself is saved) — `EligibilityRosterTestFields`
 * renders a explanatory note instead of the test UI in that case. The
 * EXTERNAL_API test tool doesn't need a campaign at all (ad-hoc
 * `POST /v1/eligibility/test-lookup`, unchanged from before this move), so
 * it works identically in create and edit mode.
 */
export function EligibilityConfigEditor({
  eligibility,
  onChange,
  campaignId,
}: {
  eligibility: EligibilityConfig;
  onChange: (next: EligibilityConfig) => void;
  campaignId: string | null;
}) {
  function updateEligibility(patch: Partial<EligibilityConfig>) {
    onChange({ ...eligibility, ...patch });
  }

  const needsApi = eligibility.mode === 'EXTERNAL_API' || eligibility.mode === 'ROSTER_AND_API';
  const needsRoster = eligibility.mode === 'ROSTER' || eligibility.mode === 'ROSTER_AND_API';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-500 mb-1">Chế độ</label>
        <select
          value={eligibility.mode}
          onChange={(e) => updateEligibility({ mode: e.target.value as EligibilityConfig['mode'] })}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          {(Object.keys(ELIGIBILITY_MODE_LABEL) as EligibilityConfig['mode'][]).map((mode) => (
            <option key={mode} value={mode}>
              {ELIGIBILITY_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </div>

      {needsApi && <EligibilityApiFields eligibility={eligibility} onChange={updateEligibility} />}

      <EligibilityRulesEditor rules={eligibility.rules ?? []} onChange={(rules) => updateEligibility({ rules })} />

      {needsRoster && <EligibilityRosterTestFields campaignId={campaignId} rules={eligibility.rules ?? []} />}
    </div>
  );
}

const ELIGIBILITY_REQUEST_METHODS: EligibilityApiRequestMethod[] = ['POST', 'GET'];
const DEFAULT_ELIGIBILITY_API: EligibilityApiConfig = {
  baseUrl: '',
  requestMethod: 'POST',
  requestPath: '',
  authType: 'API_KEY_HEADER',
};

/**
 * Inline per-campaign API config (2026-09-17 redo of plan item 7 — no more
 * "pick a client from a shared catalog" dropdown; every field the API call
 * needs is entered directly here, saved as part of THIS campaign's own
 * `eligibilityConfig.api`). `discoveredFields` is local-only state: the
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
  eligibility: EligibilityConfig;
  onChange: (patch: Partial<EligibilityConfig>) => void;
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

  function updateApi(patch: Partial<EligibilityApiConfig>) {
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Số lần thử lại khi lỗi (0-3)</label>
          <input
            type="number"
            min={0}
            max={3}
            value={api.retryCount ?? 0}
            onChange={(e) => updateApi({ retryCount: Number(e.target.value) })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
          <p className="text-xs text-gray-400 mt-1">Chỉ thử lại khi lỗi mạng/timeout — không thử lại nếu API trả lỗi rõ ràng (sai key, 4xx...).</p>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Timeout mỗi lần gọi (giây)</label>
          <input
            type="number"
            min={1}
            max={60}
            value={Math.round((api.timeoutMs ?? 15_000) / 1000)}
            onChange={(e) => updateApi({ timeoutMs: Number(e.target.value) * 1000 })}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
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
          Thử tra cứu 1 mã thật để xem field trả về (dùng cấu hình đang nhập, chưa cần lưu campaign)
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

/** Column order the roster importer actually reads today (`ROSTER_COLUMNS`, `campaign-subject.service.ts`) — shown inline so an admin doesn't have to open the template file just to see what's expected. `*` = bắt buộc. */
const ROSTER_FORMAT_COLUMNS: { label: string; required: boolean }[] = [
  { label: 'Mã SV', required: true },
  { label: 'Họ tên', required: true },
  { label: 'CCCD', required: false },
  { label: 'Lớp', required: false },
  { label: 'Khoa', required: false },
  { label: 'Ngành', required: false },
  { label: 'Ngày sinh (yyyy-mm-dd)', required: false },
  { label: 'Thời hạn thẻ (yyyy-mm-dd)', required: false },
];

/**
 * "Kiểm tra theo dữ liệu đã import" (plan item E.3, 2026-09-17) — ROSTER/
 * ROSTER_AND_API's own test tool, mirroring `EligibilityApiFields`'s "Thử"
 * UX above: calls `testRosterLookup` against THIS campaign (`campaignId` —
 * no picker needed any more, 2026-09-18: this editor is now embedded
 * directly in that campaign's own form, see this file's own doc comment)
 * plus the `rules` from the IN-PROGRESS form (not yet saved) — nothing
 * needs saving first except the campaign itself existing at all.
 *
 * `campaignId === null` (still creating a brand new campaign) → no roster
 * page to link to and nothing to test-call yet, so this renders an
 * explanatory note instead of the test UI. The format reference table
 * still shows (useful before the campaign is even saved), just not the
 * "Tải file mẫu"/test-key inputs tied to a real campaign.
 */
function EligibilityRosterTestFields({ campaignId, rules }: { campaignId: string | null; rules: EligibilityRuleConfig[] }) {
  const [testKey, setTestKey] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testEligible, setTestEligible] = useState<boolean | null>(null);
  const [testReason, setTestReason] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

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

  async function downloadTemplate() {
    try {
      const { blob, filename } = await downloadRosterImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setTemplateError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-3">
      <div className="p-2 rounded-lg bg-white border border-blue-100 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">Định dạng file Excel cần có (tham khảo)</span>
          <button type="button" onClick={() => void downloadTemplate()} className="text-xs text-blue-600 hover:text-blue-800 underline">
            Tải file mẫu
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Dòng 1 là tên cột (đúng thứ tự dưới đây), dữ liệu từ dòng 2. Cột có{' '}
          <span className="font-medium text-red-600">*</span> là bắt buộc, còn lại để trống nếu không có.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ROSTER_FORMAT_COLUMNS.map((col) => (
            <span
              key={col.label}
              className={`px-1.5 py-0.5 rounded border text-xs ${
                col.required ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}
            >
              {col.label}
              {col.required && <span className="text-red-600"> *</span>}
            </span>
          ))}
        </div>
        {templateError && <p className="text-xs text-red-600">{templateError}</p>}
        {campaignId ? (
          <a
            href={`/campaigns/${campaignId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-blue-600 hover:text-blue-800 underline pt-1"
          >
            Import roster cho campaign này → mở trang Chi tiết campaign (tab "Roster")
          </a>
        ) : (
          <p className="text-xs text-amber-700 pt-1">Lưu campaign trước để import roster và thử tra cứu bên dưới.</p>
        )}
      </div>

      {campaignId && (
        <>
          <div className="flex gap-2">
            <input
              value={testKey}
              onChange={(e) => setTestKey(e.target.value)}
              placeholder="Mã SV/CCCD..."
              className="flex-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
            />
            <button
              type="button"
              disabled={testBusy || !testKey.trim()}
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
        </>
      )}
    </div>
  );
}

function EligibilityRulesEditor({
  rules,
  onChange,
}: {
  rules: EligibilityRuleConfig[];
  onChange: (rules: EligibilityRuleConfig[]) => void;
}) {
  function updateRule(index: number, patch: Partial<EligibilityRuleConfig>) {
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
