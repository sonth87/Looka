import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, CampaignPurpose, createCampaign } from '../api';
import { CAPTURE_STEP_DEFS, StepType } from '../captureAngles';
import { CaptureFramesEditor } from './CaptureFramesEditor';
import { PURPOSE_LABEL } from '../campaignFormat';

const ALL_STEP_TYPES = Object.keys(CAPTURE_STEP_DEFS) as StepType[];

/**
 * Section card chrome for this page's two form groups — deliberately a small
 * local component rather than importing `DashboardPanel` from
 * `OverviewCharts.tsx`: that file is under concurrent edit elsewhere today,
 * and this page has no real need to share a component with the stats
 * dashboard. Same title/subtitle/body shape and the same
 * `rounded-2xl border border-gray-200 bg-white shadow-sm` card treatment
 * every other campaign page already uses (see CampaignDetail.tsx,
 * EditCampaignPage.tsx) — just declared once here instead of copy-pasted
 * per section.
 */
function FormSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

/** Small pill matching the badge treatment already used on CampaignList/CampaignDetail (`Đồng thời`, `Quay video`, ...). */
function Badge({ tone, children }: { tone: 'blue' | 'indigo' | 'rose' | 'red'; children: ReactNode }) {
  const toneClass: Record<typeof tone, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

/**
 * `formatExpiry`-equivalent for this page's *draft* state — `campaignFormat`'s
 * `formatExpiry` takes a full `Campaign` (server shape, ISO datetime), while
 * the form only has the raw `<input type="date">` string (`yyyy-mm-dd` or
 * `''`). Same "empty = vĩnh viễn" rule, same `vi-VN` date formatting, just
 * fed from the draft instead of a saved campaign.
 */
function formatDraftExpiry(expiresAt: string): string {
  if (!expiresAt) return 'Vĩnh viễn';
  return new Date(expiresAt).toLocaleDateString('vi-VN');
}

/**
 * Live "what will be created" preview — the highest-value addition of the
 * 2026-09-07 create-page redesign (see docs/ROADMAP.md). Purely derived from
 * the draft state one level up; it never reads or writes anything itself.
 * Placed as a sticky sidebar on wide viewports, stacked below the form on
 * narrow ones (see the grid in `CreateCampaignPage` below).
 */
function CampaignSummary({
  name,
  description,
  purpose,
  expiresAt,
  enabledAngles,
  simultaneous,
  recordVideo,
}: {
  name: string;
  description: string;
  purpose: CampaignPurpose;
  expiresAt: string;
  enabledAngles: Set<StepType>;
  simultaneous: boolean;
  recordVideo: boolean;
}) {
  const enabledTypes = ALL_STEP_TYPES.filter((type) => enabledAngles.has(type));
  const tooFewFrames = enabledTypes.length < 2;

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Tóm tắt campaign</h2>
      <p className="text-xs text-gray-500 mt-0.5">Cập nhật ngay khi bạn điền form — kiểm tra trước khi tạo.</p>

      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="text-xs text-gray-500">Tên campaign</dt>
          <dd className="font-semibold text-gray-900 mt-0.5 break-words">
            {name.trim() || <span className="italic font-normal text-gray-400">Chưa đặt tên</span>}
          </dd>
        </div>

        {description.trim() && (
          <div>
            <dt className="text-xs text-gray-500">Mô tả</dt>
            <dd className="text-gray-600 mt-0.5 break-words line-clamp-3">{description}</dd>
          </div>
        )}

        <div className="flex gap-6">
          <div>
            <dt className="text-xs text-gray-500">Mục đích</dt>
            <dd className="text-gray-900 mt-0.5">{PURPOSE_LABEL[purpose]}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Hạn dùng</dt>
            <dd className="text-gray-900 mt-0.5">{formatDraftExpiry(expiresAt)}</dd>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100">
          <dt className="text-xs text-gray-500 mb-1.5">
            Khung hình chụp ({enabledTypes.length}/{ALL_STEP_TYPES.length})
          </dt>
          <dd className="flex flex-wrap gap-1.5">
            {enabledTypes.map((type) => (
              <Badge key={type} tone="blue">
                {type}
              </Badge>
            ))}
          </dd>
          {tooFewFrames && <p className="text-xs text-red-600 font-medium mt-1.5">Cần tối thiểu 2 khung hình</p>}
        </div>

        <div className="pt-3 border-t border-gray-100">
          <dt className="text-xs text-gray-500 mb-1.5">Tuỳ chọn</dt>
          <dd className="flex flex-wrap gap-1.5">
            {simultaneous && <Badge tone="indigo">Đồng thời</Badge>}
            {recordVideo && <Badge tone="rose">Quay video</Badge>}
            {!simultaneous && !recordVideo && <span className="text-xs text-gray-400">Không có tuỳ chọn nào</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Dedicated create page (`/campaigns/new`) — moved out of `CampaignList`'s
 * former inline toggle-shown form essentially unchanged in content (Part 4
 * of the 2026-09-07 redesign, see docs/ROADMAP.md). On success, navigates
 * straight to the new campaign's view page rather than back to the list:
 * the freshly created campaign is exactly what the admin wants next (e.g.
 * to register its first device).
 *
 * Restructured (2026-09-07, same day) from one long single-card form into
 * titled sections plus a live summary sidebar — same fields, same submit
 * logic, same validation; only the layout changed. Two-column on wide
 * viewports (form left, sticky summary right), stacked on narrow ones.
 */
export function CreateCampaignPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState<CampaignPurpose>('STUDENT_CARD');
  const [expiresAt, setExpiresAt] = useState('');
  const [enabledAngles, setEnabledAngles] = useState<Set<StepType>>(() => new Set(ALL_STEP_TYPES));
  const [simultaneous, setSimultaneous] = useState(false);
  const [recordVideo, setRecordVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleAngle = (type: StepType) => {
    if (type === 'FRONT') return; // always on — see CaptureFramesEditor's own note below
    setEnabledAngles((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const tooFewFrames = enabledAngles.size < 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || tooFewFrames) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        purpose,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        captureAngles: ALL_STEP_TYPES.filter((type) => enabledAngles.has(type)).map((type) => CAPTURE_STEP_DEFS[type]),
        simultaneousCapture: simultaneous,
        recordVideo,
      });
      navigate(`/campaigns/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link to="/campaigns" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← Danh sách campaign
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Tạo campaign</h1>
      <p className="text-sm text-gray-500 mb-6">Xem trước kết quả trong bảng tóm tắt trong lúc bạn điền form.</p>

      <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <FormSection title="Thông tin chung" subtitle="Tên, mô tả và thời hạn sử dụng của campaign">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 mb-1">Mục đích</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as CampaignPurpose)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                >
                  {Object.entries(PURPOSE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">Hạn dùng (để trống = vĩnh viễn)</label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Cấu hình chụp" subtitle="Khung hình chụp trên kiosk và cách chụp">
            <CaptureFramesEditor
              enabled={enabledAngles}
              onToggle={toggleAngle}
              simultaneous={simultaneous}
              onSimultaneousChange={setSimultaneous}
            />

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
          </FormSection>

          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || tooFewFrames}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Đang tạo...' : 'Tạo campaign'}
            </button>
            <Link to="/campaigns" className="text-sm text-gray-500 hover:text-gray-700">
              Huỷ
            </Link>
          </div>
        </div>

        <div className="lg:sticky lg:top-8">
          <CampaignSummary
            name={name}
            description={description}
            purpose={purpose}
            expiresAt={expiresAt}
            enabledAngles={enabledAngles}
            simultaneous={simultaneous}
            recordVideo={recordVideo}
          />
        </div>
      </form>
    </div>
  );
}
