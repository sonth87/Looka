import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  CameraRoleName,
  Campaign,
  CampaignPurpose,
  CaptureConfiguration,
  CardSpec,
  CreateCampaignInput,
  UpdateCampaignInput,
  createCampaign,
  listCaptureConfigurations,
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
import { DEFAULT_CARD_SPEC } from './CardSpecFields';

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
  { id: 'section-capture', label: '2. Cấu hình chụp' },
] as const;

/**
 * Shared 2-part campaign form — Thông tin / Cấu hình chụp, with a left-side
 * section nav (ui-redesign-plan.md C2.2's mockup) — merges what used to be
 * two near-duplicate forms (`CreateCampaignPage`'s inline form and
 * `EditCampaignPage`'s `CampaignSettingsForm`). Capture-mode/simultaneous-
 * capture controls are gone entirely (moved to the kiosk's own Camera Setup
 * screen, per `campaign-config-sso-card-photo-discussion.md` §3.1.1's Q11).
 *
 * **2026-09-09 simplification** (product feedback, same day "Cấu hình mẫu
 * chụp"/`CaptureConfiguration` shipped): a campaign no longer builds its own
 * angle table / card-spec inline — it just PICKS a saved capture
 * configuration and uses it as-is. The old inline `CaptureAnglesTable`/
 * `CardSpecFields` editors moved to `CaptureConfigurationsPage.tsx`, the
 * only place that shape gets authored now; this form only ever *copies* a
 * chosen configuration's `captureAngles`/`cardSpec` into the campaign at
 * save time — see `applyCaptureConfiguration` below. `captureAngles`/
 * `cardSpec` stay campaign-owned columns (unchanged server-side, still a
 * one-time copy, never a live link to the configuration), so this is a UI
 * simplification only, not a data-model change.
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

  // 2026-09-09: no more inline angle-table/card-spec editing here — a
  // campaign just picks a saved `CaptureConfiguration` and copies its
  // `captureAngles`/`cardSpec` verbatim. `captureAngles` stays the raw
  // `Record<string, unknown>[]` shape `CreateCampaignInput`/
  // `UpdateCampaignInput` already expect — no more round-tripping through
  // `CaptureAngleRow`/`rowToCaptureStep`, since nothing here builds rows by
  // hand any more. See `applyCaptureConfiguration` below for the copy, and
  // `CaptureConfigurationsPage.tsx` for where that shape is actually authored.
  const [captureAngles, setCaptureAngles] = useState<Record<string, unknown>[]>(
    () => campaign?.captureAngles ?? []
  );
  const [recordVideo, setRecordVideo] = useState(campaign?.recordVideo ?? false);
  const [recordVideoRoles, setRecordVideoRoles] = useState<Set<CameraRoleName>>(
    () => new Set((campaign?.recordVideoRoles as CameraRoleName[] | undefined) ?? [])
  );

  const [cardSpec, setCardSpec] = useState<CardSpec>(() => ({ ...DEFAULT_CARD_SPEC, ...(campaign?.cardSpec ?? {}) }));

  // "Chọn cấu hình mẫu chụp" (item 10, 2026-09-09; required-picker
  // simplification the same day) — a saved CaptureConfiguration is a
  // one-time-copy template: picking one below replaces `captureAngles`/
  // `cardSpec` with its stored values outright. Nothing about the
  // campaign's own fields becomes a link to the configuration — see
  // `CaptureConfiguration`'s own doc comment on the API side.
  const [captureConfigurations, setCaptureConfigurations] = useState<CaptureConfiguration[] | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState('');

  useEffect(() => {
    listCaptureConfigurations()
      .then(setCaptureConfigurations)
      .catch(() => setCaptureConfigurations([])); // non-critical — the picker just shows empty rather than blocking the form
  }, []);

  function applyCaptureConfiguration(configId: string) {
    setSelectedConfigId(configId);
    const config = captureConfigurations?.find((c) => c.id === configId);
    if (!config) return;
    setCaptureAngles(config.captureAngles);
    if (config.cardSpec) {
      setCardSpec((prev) => ({ ...prev, ...config.cardSpec }));
    }
  }

  const selectedConfig = captureConfigurations?.find((c) => c.id === selectedConfigId) ?? null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardSourceCount = captureAngles.filter((a) => (a as { isCardSource?: boolean }).isCardSource === true).length;
  const tooFewRows = captureAngles.length < 1;
  const canSubmit = name.trim().length > 0 && !tooFewRows && cardSourceCount === 1;

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
          captureAngles,
          recordVideo,
          recordVideoRoles: recordVideoRoles.size > 0 ? Array.from(recordVideoRoles) : null,
          cardSpec,
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
          captureAngles,
          recordVideo,
          recordVideoRoles: recordVideoRoles.size > 0 ? Array.from(recordVideoRoles) : null,
          cardSpec,
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
          id="section-capture"
          title="2. Cấu hình chụp"
          subtitle="Chọn một mẫu cấu hình có sẵn (góc chụp + chuẩn ảnh thẻ) — quản lý các mẫu ở trang riêng"
        >
          <div>
            <label className="block text-sm text-gray-700 font-medium mb-1">Cấu hình mẫu chụp</label>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedConfigId}
                onChange={(e) => applyCaptureConfiguration(e.target.value)}
                className="flex-1 min-w-[12rem] bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                <option value="">— Chọn cấu hình —</option>
                {captureConfigurations?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.captureAngles.length} ảnh · cần tối đa {c.requiredCameraCount} camera)
                  </option>
                ))}
              </select>
              <Link
                to="/capture-configurations"
                className="text-xs text-blue-700 hover:text-blue-900 underline shrink-0"
              >
                Quản lý mẫu cấu hình →
              </Link>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Chọn mẫu sẽ điền góc chụp và chuẩn ảnh thẻ ngay bên dưới — chọn mẫu không tạo liên kết lâu dài với
              campaign này, sửa mẫu sau này không ảnh hưởng campaign đã tạo.
            </p>
          </div>

          {captureAngles.length > 0 ? (
            <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
              {!selectedConfig && mode === 'edit' && (
                <p className="text-xs text-amber-700">
                  Đang dùng cấu hình đã lưu của campaign này — chọn một mẫu ở trên để thay thế.
                </p>
              )}
              <div>
                <div className="text-xs text-gray-500 mb-1.5">
                  {captureAngles.length} góc chụp · cần tối đa{' '}
                  {new Set(captureAngles.map((a) => (a as { cameraRole?: string }).cameraRole).filter(Boolean)).size ||
                    1}{' '}
                  camera
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {captureAngles.map((a, i) => {
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
              <div className="flex items-center gap-3 text-xs text-gray-600 pt-2 border-t border-gray-200">
                <span>
                  Ảnh thẻ: {cardSpec.size ?? '4x6'} cm · {cardSpec.dpi ?? 300} dpi
                </span>
                <span className="flex items-center gap-1.5">
                  Nền:
                  <span
                    className="w-4 h-4 rounded border border-gray-300 inline-block"
                    style={{ backgroundColor: cardSpec.backgroundColor ?? '#FFFFFF' }}
                  />
                  {cardSpec.backgroundColor ?? '#FFFFFF'}
                </span>
                {cardSpec.retouch?.enabled && <span>Làm mịn: {cardSpec.retouch.strength ?? 'LIGHT'}</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Chưa chọn cấu hình — chọn một mẫu ở trên để tiếp tục.</p>
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
          {tooFewRows && (
            <span className="text-xs text-red-600 font-medium">Cần chọn một cấu hình mẫu chụp</span>
          )}
          {!tooFewRows && cardSourceCount !== 1 && (
            <span className="text-xs text-red-600 font-medium">
              Cấu hình đã chọn không hợp lệ (cần đúng 1 góc làm ảnh thẻ)
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
