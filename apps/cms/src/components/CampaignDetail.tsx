import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, Campaign, Device, getCampaign, listDevices } from '../api';
import { StatsPanel } from './StatsPanel';
import { SessionsPanel } from './SessionsPanel';
import { CampaignDangerActions } from './CampaignDangerActions';
import { DevicesPanel } from './DevicesPanel';
import { PURPOSE_LABEL, formatExpiry, isExpired } from '../campaignFormat';

/**
 * Read-only campaign view (`/campaigns/:id`) — Part 4 of the 2026-09-07
 * redesign (see docs/ROADMAP.md). Settings editing moved to its own page
 * (`EditCampaignPage`, `/campaigns/:id/edit`); this page is header + stats +
 * sessions + device registration only. Device registration stays here
 * (rather than on the edit page) because registering a kiosk is an
 * operational action naturally done while looking at a campaign, not a
 * "campaign settings" edit.
 */
export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set by a device row's "Xem ảnh đã chụp" action (2026-09-07) — drives
   * `SessionsPanel`'s device filter and scrolls it into view, since that
   * panel sits above `DevicesPanel` on this page and the admin shouldn't
   * have to manually reselect the device from its dropdown.
   */
  const [focusDeviceId, setFocusDeviceId] = useState<string | undefined>(undefined);

  const viewDeviceCaptures = (deviceId: string) => {
    setFocusDeviceId(deviceId);
    document.getElementById('sessions-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  return (
    <div>
      <Link to="/campaigns" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← Danh sách campaign
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
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
            {PURPOSE_LABEL[campaign.purpose]} · Hạn dùng: {formatExpiry(campaign)}
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

      <div className="mb-6">
        <StatsPanel campaignId={id} />
      </div>

      <div className="mb-6">
        <SessionsPanel campaignId={id} devices={devices} focusDeviceId={focusDeviceId} />
      </div>

      <DevicesPanel campaignId={id} devices={devices} onChanged={reload} onViewCaptures={viewDeviceCaptures} />
    </div>
  );
}
