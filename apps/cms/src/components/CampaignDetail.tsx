import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, Campaign, Device, getCampaign, listDevices } from '../api';
import { StatsPanel } from './StatsPanel';
import { SessionsPanel } from './SessionsPanel';
import { CampaignDangerActions } from './CampaignDangerActions';
import { CampaignStudentsPanel } from './CampaignStudentsPanel';
import { EFFECTIVE_STATUS_BADGE_CLASS, EFFECTIVE_STATUS_LABEL, PURPOSE_LABEL, computeEffectiveStatus, formatExpiry, isExpired } from '../campaignFormat';

type Tab = 'stats' | 'sessions' | 'students' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'stats', label: 'Thống kê' },
  { key: 'sessions', label: 'Phiên chụp' },
  { key: 'students', label: 'Sinh viên' },
  { key: 'settings', label: 'Cài đặt' },
];

/**
 * Read-only campaign view (`/campaigns/:id`) — 4 tabs (Thống kê / Phiên
 * chụp / Sinh viên / Cài đặt).
 *
 * A "Sinh viên dự kiến" tab (`CampaignRosterPanel`, a per-campaign
 * `campaign_student_roster` CSV-imported expected-student list) briefly
 * existed here (2026-09-09) before being removed the same day: it was built
 * on a wrong assumption about what the kiosk's CCCD scan actually checks
 * against. The corrected design has no campaign-scoped roster at all — a
 * scanned citizen id is looked up against the FULL external roster file
 * (`D:\Work\camera_server\response.json`, read-only, refreshed by a system
 * outside this app) directly from the desktop kiosk's main process, with no
 * per-campaign admin screen or CMS-side data entry involved. See
 * `apps/desktop/src/main/cccdRoster.ts` for the real mechanism.
 *
 * "Sinh viên" (`CampaignStudentsPanel`) moved in here 2026-09-08 from a
 * global cross-campaign `/students` page — product feedback: captured
 * students only make sense scoped to one campaign, not floating outside
 * all of them. "Cán bộ chụp" (`MembersPanel`,
 * the campaign_members approval queue) was REMOVED as a tab the same day,
 * same product feedback round — "không cần phân công" (no need to assign/
 * approve operators per campaign). The `campaign_members` backend model,
 * `GET/PATCH /v1/campaigns/:id/members`, and `POST /v1/campaigns/:id/join`
 * are all left untouched (not deleted) — only this admin screen is gone;
 * see this repo's own planning-memory notes for the still-open question of
 * whether the desktop app's "Đăng ký"/"Chờ duyệt" gate should also be
 * dropped now that there is no CMS UI left to actually approve anyone.
 *
 * "Thiết bị" (`DevicesPanel` — register/reissue/revoke, scoped to one
 * campaign) was ALSO removed 2026-09-08, product feedback from the SSO/
 * campaign pivot: "thiết bị không cần quản lý, vì chỉ cần cài 1 lần và
 * dùng cho nhiều campaign" — a kiosk self-enrolls once
 * (`POST /v1/devices/self-enroll`, see `apps/desktop/src/renderer/
 * CampaignGate.tsx`) and re-attaches whichever campaign the operator picks
 * next, so a *per-campaign* device roster/register-reissue-revoke workflow
 * no longer matches reality — a device is never really "this campaign's."
 * `DevicesPanel.tsx` is deleted outright (nothing else imports it); the
 * backend device endpoints (`POST .../devices`, `/reissue`, `/revoke`,
 * `/activate`) are untouched — an admin may still need to revoke a lost or
 * compromised kiosk, just not through a per-campaign management screen.
 * `listDevices`/the `devices` list itself stays: `SessionsPanel`'s own
 * device filter dropdown (Phiên chụp tab) still reads it directly.
 * Settings editing stays on its own page (`EditCampaignPage`,
 * `/campaigns/:id/edit`) — the "Cài đặt" tab here is a read-only summary
 * plus a link to it, rather than embedding the full 3-section
 * `CampaignForm` inline in a tab panel.
 */
export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stats');
  /**
   * Originally set by a device row's "Xem ảnh đã chụp" action, driving
   * `SessionsPanel`'s device filter — that action lived on `DevicesPanel`,
   * which was deleted outright 2026-09-08 (see this file's own doc comment
   * on why). `SessionsPanel` still accepts/uses this filter on its own
   * (e.g. arriving here via a direct link), so the state itself stays; only
   * the dead `'devices'` tab and its now-callerless setter function were
   * removed.
   */
  const [focusDeviceId] = useState<string | undefined>(undefined);

  const reload = () => {
    if (!id) return;
    getCampaign(id)
      .then(setCampaign)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    listDevices(id)
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [id]);

  if (error) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!campaign || !id) return <p className="text-gray-500">Đang tải...</p>;

  const effectiveStatus = computeEffectiveStatus(campaign);

  return (
    <div>
      <Link to="/campaigns" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← Danh sách campaign
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
            {campaign.code && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-600 text-xs font-mono">
                {campaign.code}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-full border text-xs font-medium ${EFFECTIVE_STATUS_BADGE_CLASS[effectiveStatus]}`}
            >
              {EFFECTIVE_STATUS_LABEL[effectiveStatus]}
            </span>
            {campaign.simultaneousCapture && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
                Đồng thời
              </span>
            )}
            {campaign.recordVideo && (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                Quay video
              </span>
            )}
            {isExpired(campaign) && (
              <span className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                Hết hạn
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {PURPOSE_LABEL[campaign.purpose]}
            {campaign.cohort ? ` · Khóa ${campaign.cohort}` : ''} · Hạn dùng: {formatExpiry(campaign)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/campaigns/${campaign.id}/edit`}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
          >
            Sửa
          </Link>
          <CampaignDangerActions campaign={campaign} onExtended={setCampaign} onDeleted={() => navigate('/campaigns')} />
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stats' && <StatsPanel campaignId={id} />}

      {tab === 'sessions' && <SessionsPanel campaignId={id} devices={devices} focusDeviceId={focusDeviceId} />}

      {tab === 'students' && <CampaignStudentsPanel campaignId={id} />}

      {tab === 'settings' && (
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
          <h2 className="font-semibold text-gray-900">Cài đặt</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Mã campaign</dt>
              <dd className="text-gray-900 mt-0.5">{campaign.code ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Khóa</dt>
              <dd className="text-gray-900 mt-0.5">{campaign.cohort ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Chỉ tiêu SV</dt>
              <dd className="text-gray-900 mt-0.5">{campaign.quotaPlanned ?? 'Không giới hạn'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Cần tối đa camera</dt>
              <dd className="text-gray-900 mt-0.5">
                {campaign.requiredCameraCount ?? (campaign.captureAngles?.length ? '—' : 0)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-gray-500">
            Sửa thông tin, bảng góc chụp và cấu hình ảnh thẻ trên trang chỉnh sửa đầy đủ.
          </p>
          <Link
            to={`/campaigns/${campaign.id}/edit`}
            className="inline-block px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
          >
            Sửa cấu hình
          </Link>
        </div>
      )}
    </div>
  );
}
