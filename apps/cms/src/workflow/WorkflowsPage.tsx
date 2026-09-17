import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  IdentificationMethod,
  Paginated,
  WorkflowConfig,
  WorkflowDetail,
  WorkflowStatus,
  WorkflowVersionSummary,
  archiveWorkflow,
  createWorkflow,
  createWorkflowDraftVersion,
  listIdentificationMethods,
  listWorkflowVersions,
  listWorkflows,
  publishWorkflow,
  updateWorkflow,
  updateWorkflowConfig,
  validateWorkflowConfig,
} from '../api';
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager';
import { WorkflowConfigEditor } from './WorkflowConfigEditor';

const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  DRAFT: 'Nháp',
  ACTIVE: 'Đang dùng',
  ARCHIVED: 'Lưu trữ',
};

/** A minimal-but-schema-valid starting config for a brand new workflow — every group needs at least this much to pass `POST /v1/workflows`' server-side zod validation (see workflow-config.schema.ts); an admin fills in the real angles/card-spec/etc. afterward via `WorkflowConfigEditor.tsx`'s `CaptureAnglesTable`/`CardSpecFields`. */
const DEFAULT_NEW_WORKFLOW_CONFIG: WorkflowConfig = {
  capture: { angles: [], clickMode: { default: 'MANUAL_SEQUENTIAL', allowed: ['MANUAL_SEQUENTIAL'] } },
  identification: { methods: ['MANUAL_LOOKUP'], lookupKeyField: 'studentCode' },
  eligibility: { mode: 'NONE' },
  aiProcessing: { enabled: false, steps: [] },
  output: {
    photoKindCode: 'DEFAULT',
    cardSpec: {
      size: '4x6',
      dpi: 300,
      backgroundColor: '#FFFFFF',
      headHeightRatio: [0.5, 0.7],
      eyeLineRatio: [0.4, 0.5],
      retouch: { enabled: false },
    },
  },
  printing: { mode: 'CENTRALIZED' },
};

/**
 * "Quy trình nghiệp vụ" (Workflow) management — a màn hoàn toàn mới (yêu
 * cầu gốc "eligibility/identification method chưa có UI"). Workflow has
 * immutable, versioned config (see `updateWorkflowConfig`'s own doc comment
 * in api.ts): editing only ever touches the current DRAFT version; publish
 * freezes it, and further edits need a fresh draft cloned from the last
 * published one.
 */
export function WorkflowsPage() {
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | ''>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paginated<WorkflowDetail> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [identificationMethods, setIdentificationMethods] = useState<IdentificationMethod[]>([]);

  useEffect(() => {
    listIdentificationMethods().then(setIdentificationMethods).catch(() => {});
  }, []);

  function reload() {
    setError(null);
    listWorkflows({ status: statusFilter || undefined, q: q.trim() || undefined, page, limit: pageSize })
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  useEffect(reload, [statusFilter, q, page, pageSize]);

  const workflows = result?.items ?? [];
  const selected = workflows.find((w) => w.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quy trình nghiệp vụ (Workflow)</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cấu hình điều kiện tiếp nhận và phương thức định danh cho một campaign — xem thêm{' '}
            <Link to="/identification-methods" className="text-blue-600 hover:text-blue-800 underline">
              danh mục phương thức định danh
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          + Tạo workflow
        </button>
      </div>

      <div className="p-4 rounded-2xl border border-gray-200 bg-white shadow-sm mb-4 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as WorkflowStatus | '');
            setPage(1);
          }}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(WORKFLOW_STATUS_LABEL) as WorkflowStatus[]).map((s) => (
            <option key={s} value={s}>
              {WORKFLOW_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã hoặc tên..."
          className="flex-1 min-w-[200px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
      </div>

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Mã</th>
              <th className="text-left px-4 py-2.5">Tên</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="text-left px-4 py-2.5">Version hiện tại</th>
              <th className="text-left px-4 py-2.5">Số campaign dùng</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {workflows.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedId(w.id)}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{w.code}</td>
                <td className="px-4 py-2.5 text-gray-700">{w.name}</td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium">
                    {WORKFLOW_STATUS_LABEL[w.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-500">{w.currentVersion ?? '— (chưa publish)'}</td>
                <td className="px-4 py-2.5 text-gray-500">{w.campaignCount}</td>
                <td className="px-4 py-2.5 text-blue-600 text-xs font-medium">Xem →</td>
              </tr>
            ))}
            {workflows.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Chưa có workflow nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        meta={result?.meta}
        itemLabel="workflow"
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {createOpen && (
        <CreateWorkflowModal
          identificationMethods={identificationMethods}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
          }}
        />
      )}

      {selected && (
        <WorkflowDetailModal
          workflow={selected}
          identificationMethods={identificationMethods}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

/**
 * Create modal now embeds the full `WorkflowConfigEditor` (plan item 5,
 * 2026-09-17) — `POST /v1/workflows` always required a full `config` body
 * (see `CreateWorkflowDto.config`'s own `@IsObject()`, no `@IsOptional()`),
 * this modal was just never offering it: it silently submitted the hardcoded
 * `DEFAULT_NEW_WORKFLOW_CONFIG` and left every real setting for a second,
 * separate "open the workflow again to configure it" step. `config` now
 * starts from that same default (still schema-valid on its own) but is a
 * normal editable field like the others, not a fixed constant.
 */
function CreateWorkflowModal({
  identificationMethods,
  onClose,
  onCreated,
}: {
  identificationMethods: IdentificationMethod[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState<WorkflowConfig>(DEFAULT_NEW_WORKFLOW_CONFIG);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createWorkflow({ code: code.trim(), name: name.trim(), description: description.trim() || undefined, config });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Tạo workflow mới</h2>
        <p className="text-xs text-gray-500">
          Cấu hình chi tiết ngay dưới đây, hoặc để mặc định và sửa lại sau — cả hai cách đều tạo ra 1 version nháp có
          thể sửa tiếp trước khi publish.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Mã (không đổi được sau khi tạo)</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Tên</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-500 mb-1">Mô tả</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        <WorkflowConfigEditor config={config} onChange={setConfig} identificationMethods={identificationMethods} />

        {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving || !code.trim() || !name.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang tạo...' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Plain-language step breadcrumb for the create→configure→publish→re-draft
 * flow (plan item 4, 2026-09-17) — this is the exact sequence
 * `WorkflowDetailModal` already enforces via `draftVersion`/`publishedBefore`
 * (see its own comments), just made visible instead of only inferable from
 * which buttons happen to be enabled.
 */
function WorkflowStepIndicator({ hasDraft, publishedBefore }: { hasDraft: boolean; publishedBefore: boolean }) {
  const steps = [
    { key: 'draft', label: 'Nháp' },
    { key: 'configure', label: 'Cấu hình' },
    { key: 'publish', label: 'Publish' },
  ] as const;
  const currentKey: (typeof steps)[number]['key'] = !publishedBefore ? 'draft' : hasDraft ? 'configure' : 'publish';

  return (
    <div className="flex items-center gap-1.5 mb-4 text-xs">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-300">→</span>}
          <span
            className={`px-2 py-1 rounded-full font-medium ${
              step.key === currentKey ? 'bg-blue-100 text-blue-700' : 'text-gray-400'
            }`}
          >
            {step.label}
          </span>
        </div>
      ))}
      <span className="text-gray-300">→</span>
      <span className="text-gray-400" title="Sau khi publish, sửa tiếp cần tạo 1 version nháp mới (không sửa lại version đã publish).">
        Sửa tiếp = version nháp mới
      </span>
    </div>
  );
}

function WorkflowDetailModal({
  workflow,
  identificationMethods,
  onClose,
  onChanged,
}: {
  workflow: WorkflowDetail;
  identificationMethods: IdentificationMethod[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  // Local editing copy — NEVER silently overwritten by a `getWorkflow()`
  // refetch after a save. See `WorkflowConfigEditor.tsx`'s own doc comment
  // and the note rendered below: `GET /v1/workflows/:id`'s `currentConfig`
  // only reliably reflects the DRAFT once the workflow has never been
  // published — once published at least once, it shows the last PUBLISHED
  // config even while a newer draft (with different content already saved
  // via `updateWorkflowConfig`) exists, since no endpoint returns one
  // specific version's config. Local state is the only trustworthy "what
  // am I actually editing right now" for the rest of this session.
  const [config, setConfig] = useState<WorkflowConfig | null>(workflow.currentConfig);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  function reloadVersions() {
    listWorkflowVersions(workflow.id).then(setVersions).catch(() => {});
  }

  useEffect(reloadVersions, [workflow.id]);

  const draftVersion = versions.find((v) => v.isDraft) ?? null;
  const publishedBefore = workflow.currentVersionId != null;
  const staleConfigWarning = draftVersion != null && publishedBefore;

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveInfo() {
    await withBusy(async () => {
      await updateWorkflow(workflow.id, { name: name.trim(), description: description.trim() || undefined });
      setMessage('Đã lưu tên/mô tả.');
      onChanged();
    });
  }

  async function checkConfig() {
    if (!config) return;
    await withBusy(async () => {
      const result = await validateWorkflowConfig(config);
      setValidationErrors(result.valid ? [] : result.errors);
      setMessage(result.valid ? 'Cấu hình hợp lệ.' : null);
    });
  }

  async function saveConfig() {
    if (!config) return;
    await withBusy(async () => {
      await updateWorkflowConfig(workflow.id, { config, note: note.trim() || undefined });
      setMessage('Đã lưu bản nháp.');
      reloadVersions();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-6 pr-12">
        <button
          onClick={onClose}
          aria-label="Đóng"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none px-2 py-1 rounded-full hover:bg-gray-100"
        >
          ✕
        </button>

        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h2 className="text-xl font-bold text-gray-900">{workflow.name}</h2>
          <span className="px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium">
            {WORKFLOW_STATUS_LABEL[workflow.status]}
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          {workflow.code} · Version hiện tại: {workflow.currentVersion ?? '— (chưa publish)'} · Dùng bởi {workflow.campaignCount} campaign
        </p>

        <WorkflowStepIndicator hasDraft={!!draftVersion} publishedBefore={publishedBefore} />

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-3">{error}</div>}
        {message && <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm mb-3">{message}</div>}
        {validationErrors && validationErrors.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm mb-3">
            <p className="font-medium mb-1">Cấu hình chưa hợp lệ:</p>
            <ul className="list-disc list-inside">
              {validationErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {staleConfigWarning && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs mb-3">
            Workflow này đã publish trước đó và đang có bản nháp mới — API hiện không có cách đọc lại đúng nội dung
            bản nháp nếu bạn rời trang rồi quay lại (chỉ đọc được bản đã publish gần nhất). Nếu bản nháp này đã được
            sửa ở phiên làm việc khác, hãy xác nhận lại nội dung trước khi lưu tiếp.
          </div>
        )}

        <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-2 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tên</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mô tả</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900" />
            </div>
          </div>
          <button type="button" onClick={() => void saveInfo()} disabled={busy} className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40">
            Lưu tên/mô tả
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {!draftVersion && (
            <button
              type="button"
              disabled={busy || !publishedBefore}
              onClick={() =>
                void withBusy(async () => {
                  await createWorkflowDraftVersion(workflow.id);
                  setMessage('Đã tạo version nháp mới (sao chép từ bản publish gần nhất).');
                  reloadVersions();
                })
              }
              title={!publishedBefore ? 'Workflow chưa publish lần nào — version 1 vẫn đang là nháp' : undefined}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
            >
              Tạo version nháp mới
            </button>
          )}
          {draftVersion && (
            <>
              <button type="button" disabled={busy || !config} onClick={() => void checkConfig()} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50">
                Kiểm tra cấu hình
              </button>
              <button type="button" disabled={busy || !config} onClick={() => void saveConfig()} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50">
                Lưu nháp
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void withBusy(async () => {
                    await publishWorkflow(workflow.id);
                    setMessage('Đã publish version này — campaign chọn workflow này sẽ dùng cấu hình mới.');
                    onChanged();
                    reloadVersions();
                  })
                }
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                Publish version {draftVersion.version}
              </button>
            </>
          )}
          {workflow.status !== 'ARCHIVED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void withBusy(async () => {
                  await archiveWorkflow(workflow.id);
                  onChanged();
                  onClose();
                })
              }
              className="ml-auto px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium disabled:opacity-50"
            >
              Lưu trữ workflow
            </button>
          )}
        </div>

        {draftVersion && config ? (
          <>
            <WorkflowConfigEditor config={config} onChange={setConfig} identificationMethods={identificationMethods} />
            <div className="mt-3">
              <label className="block text-sm text-gray-500 mb-1">Ghi chú cho lần lưu này (tuỳ chọn)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm" />
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500 p-4 text-center border border-dashed border-gray-200 rounded-xl">
            Không có version nháp — bấm "Tạo version nháp mới" ở trên để bắt đầu sửa cấu hình.
          </p>
        )}

        {versions.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Lịch sử version</h3>
            <ul className="text-xs text-gray-500 space-y-0.5">
              {[...versions].sort((a, b) => b.version - a.version).map((v) => (
                <li key={v.id}>
                  v{v.version} {v.isDraft ? '(nháp)' : `— publish lúc ${v.publishedAt}`}
                  {v.note ? ` — ${v.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
