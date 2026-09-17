import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  CameraRoleName,
  Campaign,
  CampaignPurpose,
  CreateCampaignInput,
  UpdateCampaignInput,
  WorkflowDetail,
  createCampaign,
  listWorkflows,
  updateCampaign,
} from '../api';
import { CAMERA_ROLE_LABELS } from '../captureAngles';
import {
  EFFECTIVE_STATUS_BADGE_CLASS,
  EFFECTIVE_STATUS_LABEL,
  MANUAL_STATUS_LABEL,
  PURPOSE_LABEL,
  computeEffectiveStatus,
} from '../campaignFormat';

const CAMERA_ROLES: CameraRoleName[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];

/** `<input type="datetime-local">` <-> ISO helpers — the mockup's "Bắt đầu [01/09/2026 08:00]" fields carry a time, unlike the old expiry-only `type="date"` input. */
function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDatetimeLocal(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm scroll-mt-6">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { id: 'section-info', label: '1. Thông tin' },
  { id: 'section-workflow', label: '2. Workflow' },
] as const;

/**
 * Shared 2-part campaign form — Thông tin / Workflow, with a left-side
 * section nav (ui-redesign-plan.md C2.2's mockup) — merges what used to be
 * two near-duplicate forms (`CreateCampaignPage`'s inline form and
 * `EditCampaignPage`'s `CampaignSettingsForm`). Capture-mode/simultaneous-
 * capture controls are gone entirely (moved to the kiosk's own Camera Setup
 * screen, per `campaign-config-sso-card-photo-discussion.md` §3.1.1's Q11).
 *
 * **2026-09-17 retirement of "Mẫu chụp" (`CaptureConfiguration`)** — the
 * user flagged that Workflow and the standalone "Mẫu chụp" picker this form
 * used to have (2026-09-09 through 2026-09-16) carried the exact same
 * fields (capture angles, card spec) and made an operator configure them
 * TWICE: once in a `CaptureConfiguration` template, again by picking one
 * here ("workflow và mẫu chụp đang có nhiều trường thông tin giống nhau …
 * chỉ config 1 lần"). Direction confirmed via AskUserQuestion: the "Tạo
 * Workflow" screen (`WorkflowsPage.tsx`'s `WorkflowConfigEditor`, already
 * has a full capture+card-spec editor since plan item 6) becomes the SINGLE
 * place that config gets authored; this form only ever *picks* a published
 * workflow version, never edits or copies angles/card-spec itself.
 *
 * This form no longer sends `captureAngles`/`cardSpec` at all — those stay
 * whatever they already are on the campaign row (`undefined` in the
 * request body means "leave unchanged", see `CampaignService.updateCampaign`).
 * `GET`s already resolve the *effective* angles/card-spec from the pinned
 * workflow whenever the campaign's own columns are null
 * (`CampaignService.toCampaignResponse`'s override-merge, P2) — so a
 * campaign created here purely from a workflow pin has nothing of its own
 * to conflict with a later re-pin. A campaign that still carries values
 * copied in by the old "Mẫu chụp" flow keeps using those verbatim (this
 * form has no way to clear that legacy column) — a known, low-volume gap
 * from before this retirement, not something a re-pin here can fix.
 *
 * `mode="create"` calls `createCampaign`; `mode="edit"` calls `updateCampaign`
 * with only the fields this form owns (same partial-PATCH shape the old
 * `CampaignSettingsForm` used). The caller (`CreateCampaignPage`/
 * `EditCampaignPage`) supplies navigation — this component only knows how to
 * build a draft and submit it.
 */
export function CampaignForm({
  mode,
  campaign,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit';
  /** Required for `mode="edit"` — the campaign being edited. */
  campaign?: Campaign;
  onSaved: (campaign: Campaign) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(campaign?.code ?? '');
  const [name, setName] = useState(campaign?.name ?? '');
  const [cohort, setCohort] = useState(campaign?.cohort ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [purpose, setPurpose] = useState<CampaignPurpose>(campaign?.purpose ?? 'STUDENT_CARD');
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(campaign?.startsAt));
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocal(campaign?.expiresAt));
  const [quotaPlanned, setQuotaPlanned] = useState(
    campaign?.quotaPlanned != null ? String(campaign.quotaPlanned) : ''
  );
  const [manualStatus, setManualStatus] = useState<'' | 'PAUSED' | 'CLOSED'>(campaign?.manualStatus ?? '');
  const [consentContent, setConsentContent] = useState(campaign?.consentContent ?? '');

  const [recordVideo, setRecordVideo] = useState(campaign?.recordVideo ?? false);
  const [recordVideoRoles, setRecordVideoRoles] = useState<Set<CameraRoleName>>(
    () => new Set((campaign?.recordVideoRoles as CameraRoleName[] | undefined) ?? [])
  );
  const [requiresEmbedding, setRequiresEmbedding] = useState(campaign?.requiresEmbedding ?? true);

  // "2. Workflow" (Phase 5, cms-8-screens-api-plan.md §2.2/P2; sole capture-
  // config source as of the 2026-09-17 "Mẫu chụp" retirement above) — pin to
  // a PUBLISHED workflow version; picking one just sets `workflowVersionId`,
  // `workflowId` itself is derived server-side (see
  // `CreateCampaignDto.workflowVersionId`'s own doc comment) so it's never
  // sent from here. Only ACTIVE workflows that have actually published at
  // least once (`currentVersionId != null`) are selectable — a draft-only
  // workflow has nothing valid to pin to yet.
  const [workflows, setWorkflows] = useState<WorkflowDetail[] | null>(null);
  const [workflowVersionId, setWorkflowVersionId] = useState(campaign?.workflow?.versionId ?? '');

  useEffect(() => {
    listWorkflows({ status: 'ACTIVE' })
      .then((r) => setWorkflows(r.items))
      .catch(() => setWorkflows([]));
  }, []);

  const selectableWorkflows = (workflows ?? []).filter((w) => w.currentVersionId != null);
  // The campaign's currently-pinned workflow might be ARCHIVED or otherwise
  // excluded from the ACTIVE-only fetch above — still show it as the
  // selected option so the picker doesn't silently blank out an existing pin.
  const pinnedWorkflowMissing =
    campaign?.workflow != null && !selectableWorkflows.some((w) => w.currentVersionId === campaign.workflow?.versionId);

  const selectedWorkflow = selectableWorkflows.find((w) => w.currentVersionId === workflowVersionId) ?? null;
  // Only show the SELECTED workflow's own config as a live preview once the
  // picker actually changed from the campaign's current pin — until then,
  // `campaign.captureAngles`/`cardSpec` (already the server's resolved,
  // possibly-workflow-merged values, see this component's own doc comment)
  // are the more accurate "what this campaign currently uses" preview.
  const workflowPinChanged = workflowVersionId !== (campaign?.workflow?.versionId ?? '');
  const previewAngles = workflowPinChanged
    ? selectedWorkflow?.currentConfig?.capture.angles ?? null
    : campaign?.captureAngles ?? null;
  const previewCardSpec = workflowPinChanged
    ? selectedWorkflow?.currentConfig?.output.cardSpec ?? null
    : campaign?.cardSpec ?? null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new campaign has nowhere else to get capture angles/card spec from
  // now that "Mẫu chụp" is gone — picking a workflow is required on create.
  // An existing campaign edited here keeps whatever it already has even if
  // no workflow is (re-)selected, so editing an old campaign never gets
  // newly blocked by this rule.
  const canSubmit = name.trim().length > 0 && (mode === 'edit' || workflowVersionId !== '');

  const effectiveStatus = computeEffectiveStatus({
    effectiveStatus: undefined,
    manualStatus: manualStatus || null,
    startsAt: fromDatetimeLocal(startsAt) ?? null,
    expiresAt: fromDatetimeLocal(expiresAt) ?? null,
  });

  function toggleVideoRole(role: CameraRoleName) {
    setRecordVideoRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const parsedQuota = quotaPlanned.trim() ? Number(quotaPlanned) : null;

    try {
      if (mode === 'create') {
        const input: CreateCampaignInput = {
          code: code.trim() || undefined,
          name: name.trim(),
          description: description.trim() || undefined,
          purpose,
          cohort: cohort.trim() || undefined,
          startsAt: fromDatetimeLocal(startsAt),
          expiresAt: fromDatetimeLocal(expiresAt),
          quotaPlanned: parsedQuota,
          manualStatus: manualStatus || null,
          consentContent: consentContent.trim() || undefined,
          recordVideo,
          recordVideoRoles: recordVideoRoles.size > 0 ? Array.from(recordVideoRoles) : null,
          requiresEmbedding,
          workflowVersionId: workflowVersionId || undefined,
        };
        const created = await createCampaign(input);
        onSaved(created);
      } else if (campaign) {
        const input: UpdateCampaignInput = {
          code: code.trim() || undefined,
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          cohort: cohort.trim() || undefined,
          startsAt: fromDatetimeLocal(startsAt) ?? null,
          expiresAt: fromDatetimeLocal(expiresAt) ?? null,
          quotaPlanned: parsedQuota,
          manualStatus: manualStatus || null,
          consentContent: consentContent.trim() || undefined,
          recordVideo,
          recordVideoRoles: recordVideoRoles.size > 0 ? Array.from(recordVideoRoles) : null,
          requiresEmbedding,
          workflowVersionId: workflowVersionId || null,
        };
        const updated = await updateCampaign(campaign.id, input);
        onSaved(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-6 items-start">
      <nav className="lg:sticky lg:top-8 space-y-1 hidden lg:block">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="block px-2.5 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="space-y-6 min-w-0">
        <Section id="section-info" title="1. Thông tin" subtitle="Mã, tên, thời gian và trạng thái campaign">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Mã campaign</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="2026DOT01"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Khóa</label>
              <input
                value={cohort}
                onChange={(e) => setCohort(e.target.value)}
                placeholder="K20"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">Tên campaign</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
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

          <div>
            <label className="block text-sm text-gray-500 mb-1">
              Mục đích{mode === 'edit' ? ' (không đổi được sau khi tạo)' : ''}
            </label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as CampaignPurpose)}
              disabled={mode === 'edit'}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
            >
              {Object.entries(PURPOSE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Bắt đầu chụp (để trống = ngay bây giờ)</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Hết hạn chụp (để trống = vĩnh viễn)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Chỉ tiêu SV (để trống = không giới hạn)</label>
              <input
                type="number"
                min={0}
                value={quotaPlanned}
                onChange={(e) => setQuotaPlanned(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Trạng thái thủ công</label>
              <select
                value={manualStatus}
                onChange={(e) => setManualStatus(e.target.value as '' | 'PAUSED' | 'CLOSED')}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                {(['', 'PAUSED', 'CLOSED'] as const).map((v) => (
                  <option key={v} value={v}>
                    {MANUAL_STATUS_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Trạng thái hiệu lực:</span>
            <span
              className={`px-2 py-0.5 rounded-full border text-xs font-medium ${EFFECTIVE_STATUS_BADGE_CLASS[effectiveStatus]}`}
            >
              {EFFECTIVE_STATUS_LABEL[effectiveStatus]}
            </span>
            <span className="text-xs text-gray-400">(tự suy từ ngày, cập nhật ngay khi bạn sửa form)</span>
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">
              Nội dung consent{campaign ? ` (v${campaign.consentVersion}) — sửa sẽ tăng version` : ''}
            </label>
            <textarea
              value={consentContent}
              onChange={(e) => setConsentContent(e.target.value)}
              rows={3}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </div>
        </Section>

        <Section
          id="section-workflow"
          title="2. Workflow"
          subtitle="Nguồn duy nhất cho góc chụp, chuẩn ảnh thẻ, điều kiện tiếp nhận và phương thức định danh — quản lý các workflow ở trang riêng"
        >
          <div>
            <label className="block text-sm text-gray-700 font-medium mb-1">
              Workflow{mode === 'create' ? ' *' : ''}
            </label>
            <select
              value={workflowVersionId}
              onChange={(e) => setWorkflowVersionId(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            >
              <option value="">— Không dùng workflow —</option>
              {pinnedWorkflowMissing && campaign?.workflow && (
                <option value={campaign.workflow.versionId}>
                  {campaign.workflow.code} (v{campaign.workflow.version}) — hiện đang gán, không còn ở trạng thái Đang dùng
                </option>
              )}
              {selectableWorkflows.map((w) => (
                <option key={w.id} value={w.currentVersionId ?? ''}>
                  {w.code} — {w.name} (v{w.currentVersion})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Ghim vào version workflow đã publish tại thời điểm chọn — publish version mới sau đó không tự áp dụng lại,
              cần chọn lại ở đây.{' '}
              <Link to="/workflows" className="text-blue-600 hover:text-blue-800 underline">
                Quản lý workflow →
              </Link>
            </p>
          </div>

          {previewAngles && previewAngles.length > 0 ? (
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
              <div>
                <div className="text-xs text-gray-500 mb-1.5">
                  {previewAngles.length} góc chụp · cần tối đa{' '}
                  {new Set(previewAngles.map((a) => (a as { cameraRole?: string }).cameraRole).filter(Boolean)).size ||
                    1}{' '}
                  camera
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {previewAngles.map((a, i) => {
                    const angle = a as { angleCode?: string; cameraRole?: string; isCardSource?: boolean };
                    return (
                      <span
                        key={i}
                        className={`px-2 py-1 rounded-lg border text-xs ${
                          angle.isCardSource
                            ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                            : 'border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        {angle.angleCode ?? `Góc ${i + 1}`}
                        {angle.cameraRole ? ` · ${CAMERA_ROLE_LABELS[angle.cameraRole as CameraRoleName] ?? angle.cameraRole}` : ''}
                        {angle.isCardSource ? ' · ảnh thẻ' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
              {previewCardSpec && (
                <div className="flex items-center gap-3 text-xs text-gray-600 pt-2 border-t border-gray-200">
                  <span>
                    Ảnh thẻ: {previewCardSpec.size ?? '4x6'} cm · {previewCardSpec.dpi ?? 300} dpi
                  </span>
                  <span className="flex items-center gap-1.5">
                    Nền:
                    <span
                      className="w-4 h-4 rounded border border-gray-300 inline-block"
                      style={{ backgroundColor: previewCardSpec.backgroundColor ?? '#FFFFFF' }}
                    />
                    {previewCardSpec.backgroundColor ?? '#FFFFFF'}
                  </span>
                  {previewCardSpec.retouch?.enabled && <span>Làm mịn: {previewCardSpec.retouch.strength ?? 'LIGHT'}</span>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {workflowVersionId
                ? 'Workflow này chưa cấu hình góc chụp.'
                : 'Chưa chọn workflow — góc chụp và chuẩn ảnh thẻ lấy từ workflow được chọn ở trên.'}
            </p>
          )}

          <div className="pt-3 border-t border-gray-100">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={recordVideo}
                onChange={(e) => setRecordVideo(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>
                <span className="block font-medium text-gray-700">Quay video trong lúc chụp</span>
                <span className="block text-xs text-gray-500">
                  Ghi lại video local trên kiosk trong suốt phiên chụp (không upload lên máy chủ).
                </span>
              </span>
            </label>
            {recordVideo && (
              <div className="mt-2 flex flex-wrap gap-3 pl-6 text-sm">
                {CAMERA_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-gray-700">
                    <input
                      type="checkbox"
                      checked={recordVideoRoles.has(role)}
                      onChange={() => toggleVideoRole(role)}
                      className="rounded border-gray-300"
                    />
                    {CAMERA_ROLE_LABELS[role]}
                  </label>
                ))}
                <span className="text-xs text-gray-400 basis-full">Không chọn camera nào = ghi mọi camera.</span>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-gray-100">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresEmbedding}
                onChange={(e) => setRequiresEmbedding(e.target.checked)}
                className="rounded border-gray-300 mt-0.5"
              />
              <span>
                <span className="block font-medium text-gray-700">Yêu cầu đăng ký khuôn mặt (embedding)</span>
                <span className="block text-xs text-gray-500">
                  Gửi ảnh sinh viên lên máy chủ nhận diện khuôn mặt bên ngoài trong lúc chụp — dùng cho điểm danh/xác
                  thực sau này. Tắt nếu campaign này không cần.
                </span>
              </span>
            </label>
          </div>
        </Section>

        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !canSubmit}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : mode === 'create' ? 'Tạo campaign' : 'Lưu campaign'}
          </button>
          <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
            Huỷ
          </button>
          {mode === 'create' && workflowVersionId === '' && (
            <span className="text-xs text-red-600 font-medium">Cần chọn một workflow</span>
          )}
        </div>
      </div>
    </form>
  );
}
