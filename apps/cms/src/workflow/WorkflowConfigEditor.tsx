import { useState } from 'react';
import {
  ApiError,
  EligibilityApiClient,
  IdentificationMethod,
  WorkflowConfig,
  WorkflowConfigEligibility,
  WorkflowConfigEligibilityRule,
  testEligibilityLookup,
} from '../api';

const ELIGIBILITY_MODE_LABEL: Record<WorkflowConfigEligibility['mode'], string> = {
  NONE: 'Không kiểm tra (ai cũng chụp được)',
  ROSTER: 'Theo danh sách roster đã nạp',
  EXTERNAL_API: 'Theo API ngoài',
  ROSTER_AND_API: 'Roster + API ngoài',
};

const RAW_JSON_GROUPS = ['capture', 'aiProcessing', 'output', 'printing'] as const;
const RAW_JSON_GROUP_LABEL: Record<(typeof RAW_JSON_GROUPS)[number], string> = {
  capture: 'Chụp ảnh (capture)',
  aiProcessing: 'Xử lý AI (aiProcessing)',
  output: 'Đầu ra / ảnh thẻ (output)',
  printing: 'In ấn (printing)',
};

/**
 * Structured editor for a workflow draft version's `config` — deliberately
 * only `eligibility`/`identification` get real form fields (the two groups
 * this whole CMS update was originally asked for); the other 4 groups
 * (`capture`/`aiProcessing`/`output`/`printing`) are edited as raw JSON
 * textareas. Rich editors for those would duplicate the separate, older
 * `CaptureConfiguration` system's own angle/card-spec editing (never
 * unified with workflow config) — a real gap, but a bigger, separate piece
 * of work than this pass, not something to paper over with a half-built
 * second editor for the same data.
 *
 * Fully controlled (`config`/`onChange`) — this component holds no server
 * state itself; the caller (`WorkflowsPage.tsx`) owns save/validate/publish.
 */
export function WorkflowConfigEditor({
  config,
  onChange,
  identificationMethods,
  eligibilityApiClients,
}: {
  config: WorkflowConfig;
  onChange: (next: WorkflowConfig) => void;
  identificationMethods: IdentificationMethod[];
  eligibilityApiClients: EligibilityApiClient[];
}) {
  const [rawJsonText, setRawJsonText] = useState<Record<string, string>>(() =>
    Object.fromEntries(RAW_JSON_GROUPS.map((g) => [g, JSON.stringify(config[g], null, 2)]))
  );
  const [rawJsonError, setRawJsonError] = useState<Record<string, string | null>>({});

  function updateEligibility(patch: Partial<WorkflowConfigEligibility>) {
    onChange({ ...config, eligibility: { ...config.eligibility, ...patch } });
  }

  function updateRawJsonGroup(group: (typeof RAW_JSON_GROUPS)[number], text: string) {
    setRawJsonText((prev) => ({ ...prev, [group]: text }));
    try {
      const parsed = JSON.parse(text);
      setRawJsonError((prev) => ({ ...prev, [group]: null }));
      onChange({ ...config, [group]: parsed });
    } catch {
      setRawJsonError((prev) => ({ ...prev, [group]: 'JSON không hợp lệ — chưa áp dụng thay đổi này' }));
    }
  }

  const selectedClient = eligibilityApiClients.find((c) => c.code === config.eligibility.api?.clientCode) ?? null;
  const needsApi = config.eligibility.mode === 'EXTERNAL_API' || config.eligibility.mode === 'ROSTER_AND_API';
  const needsRoster = config.eligibility.mode === 'ROSTER' || config.eligibility.mode === 'ROSTER_AND_API';

  return (
    <div className="space-y-5">
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
          <EligibilityApiFields
            eligibility={config.eligibility}
            clients={eligibilityApiClients}
            selectedClient={selectedClient}
            onChange={updateEligibility}
          />
        )}

        <EligibilityRulesEditor
          rules={config.eligibility.rules ?? []}
          onChange={(rules) => updateEligibility({ rules })}
        />
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

      <section className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Cấu hình nâng cao (JSON)</h3>
        <p className="text-xs text-gray-500">
          4 nhóm còn lại chưa có giao diện riêng ở lần cập nhật này — sửa trực tiếp JSON, dùng nút "Kiểm tra cấu hình"
          ở màn cha để xác nhận trước khi lưu.
        </p>
        {RAW_JSON_GROUPS.map((group) => (
          <div key={group}>
            <label className="block text-sm text-gray-500 mb-1">{RAW_JSON_GROUP_LABEL[group]}</label>
            <textarea
              value={rawJsonText[group]}
              onChange={(e) => updateRawJsonGroup(group, e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 font-mono text-xs"
            />
            {rawJsonError[group] && <p className="text-xs text-red-600 mt-1">{rawJsonError[group]}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}

function EligibilityApiFields({
  eligibility,
  clients,
  selectedClient,
  onChange,
}: {
  eligibility: WorkflowConfigEligibility;
  clients: EligibilityApiClient[];
  selectedClient: EligibilityApiClient | null;
  onChange: (patch: Partial<WorkflowConfigEligibility>) => void;
}) {
  const [testKey, setTestKey] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function runTest() {
    if (!eligibility.api?.clientCode || !testKey.trim()) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testEligibilityLookup(eligibility.api.clientCode, testKey.trim());
      setTestResult(result.success ? JSON.stringify(result.sampleRecord, null, 2) : result.message ?? 'Không tìm thấy.');
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="pl-3 border-l-2 border-gray-200 space-y-3">
      <div>
        <label className="block text-sm text-gray-500 mb-1">API ngoài</label>
        <select
          value={eligibility.api?.clientCode ?? ''}
          onChange={(e) => onChange({ api: { clientCode: e.target.value, keyField: '', requiredFields: [] } })}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">— Chọn API —</option>
          {clients.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {selectedClient && (
        <>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Trường dùng làm khoá tra cứu</label>
            <select
              value={eligibility.api?.keyField ?? ''}
              onChange={(e) => onChange({ api: { ...eligibility.api!, keyField: e.target.value } })}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            >
              <option value="">— Chọn field —</option>
              {selectedClient.fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Field bắt buộc phải khớp (tuỳ chọn)</label>
            <div className="flex flex-wrap gap-2">
              {selectedClient.fields.map((f) => {
                const checked = (eligibility.api?.requiredFields ?? []).includes(f);
                return (
                  <label key={f} className="flex items-center gap-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-full px-2 py-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = eligibility.api?.requiredFields ?? [];
                        const next = e.target.checked ? [...current, f] : current.filter((x) => x !== f);
                        onChange({ api: { ...eligibility.api!, requiredFields: next } });
                      }}
                      className="rounded border-gray-300"
                    />
                    {f}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
            <label className="block text-xs text-blue-800">Thử tra cứu 1 mã thật để xem field trả về</label>
            <div className="flex gap-2">
              <input
                value={testKey}
                onChange={(e) => setTestKey(e.target.value)}
                placeholder="Nhập mã để thử..."
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
            {testError && <p className="text-xs text-red-600">{testError}</p>}
            {testResult && <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-40">{testResult}</pre>}
          </div>
        </>
      )}
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
