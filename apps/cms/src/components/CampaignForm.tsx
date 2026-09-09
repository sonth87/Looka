import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  CameraRoleName,
  Campaign,
  CampaignPurpose,
  CardSpec,
  CreateCampaignInput,
  UpdateCampaignInput,
  createCampaign,
  updateCampaign,
} from '../api';
import { CAMERA_ROLE_LABELS } from '../captureAngles';
import { CaptureAngleRow, captureStepToRow, fallbackRowsFromStepDefs, rowToCaptureStep } from '../captureAngleSteps';
import {
  EFFECTIVE_STATUS_BADGE_CLASS,
  EFFECTIVE_STATUS_LABEL,
  MANUAL_STATUS_LABEL,
  PURPOSE_LABEL,
  computeEffectiveStatus,
} from '../campaignFormat';
import { CaptureAnglesTable, MIN_ROWS } from './CaptureAnglesTable';

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
  { id: 'section-capture', label: '2. Ảnh chụp' },
  { id: 'section-card', label: '3. Ảnh thẻ' },
] as const;

const CARD_SIZE_OPTIONS = ['3x4', '4x6'];
const CARD_DPI_OPTIONS = [300, 600];
const RETOUCH_STRENGTHS: NonNullable<CardSpec['retouch']>['strength'][] = ['LIGHT', 'MEDIUM', 'STRONG'];
const RETOUCH_STRENGTH_LABEL: Record<string, string> = { LIGHT: 'Nhẹ', MEDIUM: 'Vừa', STRONG: 'Mạnh' };

const DEFAULT_CARD_SPEC: Required<Pick<CardSpec, 'size' | 'dpi' | 'backgroundColor' | 'headHeightRatio' | 'eyeLineRatio'>> & {
  retouch: NonNullable<CardSpec['retouch']>;
} = {
  size: '4x6',
  dpi: 300,
  backgroundColor: '#FFFFFF',
  headHeightRatio: [0.7, 0.8],
  eyeLineRatio: [0.4, 0.45],
  retouch: { enabled: true, strength: 'LIGHT' },
};

/**
 * Shared 3-part campaign form — Thông tin / Ảnh chụp / Ảnh thẻ, with a
 * left-side section nav (ui-redesign-plan.md C2.2's mockup) — merges what
 * used to be two near-duplicate forms (`CreateCampaignPage`'s inline form and
 * `EditCampaignPage`'s `CampaignSettingsForm`). Capture-mode/simultaneous-
 * capture controls are gone entirely (moved to the kiosk's own Camera Setup
 * screen, per `campaign-config-sso-card-photo-discussion.md` §3.1.1's Q11).
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

  const [rows, setRows] = useState<CaptureAngleRow[]>(() => {
    if (campaign?.captureAngles && campaign.captureAngles.length > 0) {
      return campaign.captureAngles.map(captureStepToRow);
    }
    return mode === 'create' ? fallbackRowsFromStepDefs() : [];
  });
  const [recordVideo, setRecordVideo] = useState(campaign?.recordVideo ?? false);
  const [recordVideoRoles, setRecordVideoRoles] = useState<Set<CameraRoleName>>(
    () => new Set((campaign?.recordVideoRoles as CameraRoleName[] | undefined) ?? [])
  );

  const [cardSpec, setCardSpec] = useState<CardSpec>(() => ({ ...DEFAULT_CARD_SPEC, ...(campaign?.cardSpec ?? {}) }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardSourceCount = rows.filter((r) => r.isCardSource).length;
  const tooFewRows = rows.length < MIN_ROWS;
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

    const captureAngles = rows.map((row, i) => rowToCaptureStep(row, i));
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
          title="2. Ảnh chụp"
          subtitle="Bảng góc chụp mục tiêu — kiosk tự lập kế hoạch vòng theo số camera thực tế của máy"
        >
          <CaptureAnglesTable rows={rows} onChange={setRows} />

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

        <Section id="section-card" title="3. Ảnh thẻ" subtitle="Chuẩn crop/nền/làm mịn cho ảnh thẻ dẫn xuất">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Cỡ ảnh</label>
              <select
                value={cardSpec.size ?? '4x6'}
                onChange={(e) => setCardSpec((s) => ({ ...s, size: e.target.value }))}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                {CARD_SIZE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} cm
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">DPI</label>
              <select
                value={cardSpec.dpi ?? 300}
                onChange={(e) => setCardSpec((s) => ({ ...s, dpi: Number(e.target.value) }))}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                {CARD_DPI_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-500">Màu nền</label>
            <input
              type="color"
              value={cardSpec.backgroundColor ?? '#FFFFFF'}
              onChange={(e) => setCardSpec((s) => ({ ...s, backgroundColor: e.target.value }))}
              className="w-10 h-8 rounded border border-gray-300"
            />
            <span className="text-xs text-gray-500 font-mono">{cardSpec.backgroundColor ?? '#FFFFFF'}</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cardSpec.retouch?.enabled ?? true}
                onChange={(e) =>
                  setCardSpec((s) => ({ ...s, retouch: { ...s.retouch, enabled: e.target.checked } }))
                }
                className="rounded border-gray-300"
              />
              Làm mịn
            </label>
            {cardSpec.retouch?.enabled && (
              <select
                value={cardSpec.retouch?.strength ?? 'LIGHT'}
                onChange={(e) =>
                  setCardSpec((s) => ({
                    ...s,
                    retouch: { ...s.retouch, strength: e.target.value as NonNullable<CardSpec['retouch']>['strength'] },
                  }))
                }
                className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
              >
                {RETOUCH_STRENGTHS.map((v) => (
                  <option key={v} value={v}>
                    {RETOUCH_STRENGTH_LABEL[v as string]}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Tỉ lệ chiều cao đầu (0–1)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={cardSpec.headHeightRatio?.[0] ?? 0.7}
                  onChange={(e) =>
                    setCardSpec((s) => ({
                      ...s,
                      headHeightRatio: [Number(e.target.value), s.headHeightRatio?.[1] ?? 0.8],
                    }))
                  }
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={cardSpec.headHeightRatio?.[1] ?? 0.8}
                  onChange={(e) =>
                    setCardSpec((s) => ({
                      ...s,
                      headHeightRatio: [s.headHeightRatio?.[0] ?? 0.7, Number(e.target.value)],
                    }))
                  }
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Tỉ lệ đường mắt (0–1, từ trên xuống)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={cardSpec.eyeLineRatio?.[0] ?? 0.4}
                  onChange={(e) =>
                    setCardSpec((s) => ({ ...s, eyeLineRatio: [Number(e.target.value), s.eyeLineRatio?.[1] ?? 0.45] }))
                  }
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={cardSpec.eyeLineRatio?.[1] ?? 0.45}
                  onChange={(e) =>
                    setCardSpec((s) => ({ ...s, eyeLineRatio: [s.eyeLineRatio?.[0] ?? 0.4, Number(e.target.value)] }))
                  }
                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Xem trước khung crop (minh hoạ, không dùng ảnh thật)</div>
            <div
              className="relative w-28 rounded-lg border border-gray-300 overflow-hidden"
              style={{ aspectRatio: '2 / 3', backgroundColor: cardSpec.backgroundColor ?? '#FFFFFF' }}
            >
              <div
                className="absolute left-1/2 -translate-x-1/2 rounded-full bg-gray-300"
                style={{
                  bottom: 0,
                  width: '55%',
                  height: `${(cardSpec.headHeightRatio?.[1] ?? 0.8) * 100}%`,
                }}
              />
              <div
                className="absolute left-0 right-0 border-t border-dashed border-blue-400"
                style={{ top: `${(cardSpec.eyeLineRatio?.[0] ?? 0.4) * 100}%` }}
              />
            </div>
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
            <span className="text-xs text-red-600 font-medium">Cần tối thiểu {MIN_ROWS} góc chụp</span>
          )}
          {!tooFewRows && cardSourceCount !== 1 && (
            <span className="text-xs text-red-600 font-medium">Cần đúng 1 dòng làm ảnh thẻ</span>
          )}
        </div>
      </div>
    </form>
  );
}
