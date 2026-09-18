import { useEffect, useState } from 'react';
import { ApiError, Device, DeviceStatus, listDevices } from '../api';

const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  REGISTERED: 'Đã đăng ký',
  ACTIVATED: 'Đã kích hoạt',
  REVOKED: 'Đã thu hồi',
};

/**
 * "Thiết bị" tab — 2026-09-18, rewritten from a gán-người-vào-kiosk editor
 * into a plain read-only device roster, per product decision: campaign
 * access no longer runs through a person↔kiosk pairing at all (the deleted
 * `campaign_kiosk_assignments` table/`CampaignKioskAssignmentService` — see
 * `CampaignMemberService.grant()`'s own doc comment for the replacement
 * "Cấp quyền" flow, now on `CampaignList.tsx` instead of this tab).
 *
 * Drives its table off `GET /v1/campaigns/:id/devices` (`listDevices`) — the
 * same plain, assignment-agnostic endpoint that already existed for this
 * purpose (confirmed via a full repo audit before the kiosk-assignment
 * removal: this was never a `campaign_kiosk_assignments`-only concept).
 * "Người dùng gần nhất" reads straight off each device's own
 * `lastUserName`/`lastUserId` (set by self-enrollment, per-login — see
 * `Device.lastUserId`'s own doc comment) instead of any pairing table —
 * "—" when a device has never self-enrolled/logged in.
 */
export function CampaignAssignmentsPanel({ campaignId }: { campaignId: string }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listDevices(campaignId)
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [campaignId]);

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {devices === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {devices !== null && devices.length === 0 && !error && (
        <p className="text-sm text-gray-500">
          Campaign này chưa có kiosk nào được thiết lập. Thiết bị tự xuất hiện ở đây sau khi kiosk tự đăng ký và
          chọn campaign này lần đầu.
        </p>
      )}

      {devices !== null && devices.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Kiosk</th>
              <th className="py-2.5 px-4">Trạng thái</th>
              <th className="py-2.5 px-4">Người dùng gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-900 font-medium">{d.name}</td>
                <td className="py-2.5 px-4 text-gray-500">{DEVICE_STATUS_LABEL[d.status] ?? d.status}</td>
                <td className="py-2.5 px-4 text-gray-900">{d.lastUserName ?? d.lastUserId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
