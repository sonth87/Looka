import { useEffect, useState } from 'react';
import {
  ApiError,
  CampaignKioskSummary,
  DeviceStatus,
  UserListItem,
  assignCampaignKiosk,
  listCampaignKiosks,
  listUsers,
  unassignCampaignKiosk,
} from '../api';
import { ModalShell } from './CampaignDangerActions';

const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  REGISTERED: 'Đã đăng ký',
  ACTIVATED: 'Đã kích hoạt',
  REVOKED: 'Đã thu hồi',
};

/**
 * "Thiết bị & Nhân sự" tab — rebuilt 2026-09-14 under new product direction,
 * reversing the 2026-09-08 removal of the old "Thiết bị"/"Cán bộ chụp" tabs
 * (see `CampaignDetail.tsx`'s own doc comment for that history). Lets an
 * admin assign one staff user to one kiosk device within this campaign.
 * Assigning also auto-approves that user's `campaign_members` row as a
 * server-side side effect (`CampaignKioskAssignmentService.assign`, D-Q4
 * "gán = tự duyệt") — there is no separate "add member" step in this UI.
 *
 * Drives its table off `GET /v1/campaigns/:id/kiosks` (`listCampaignKiosks`)
 * rather than `GET .../assignments` (`listCampaignAssignments`, also added
 * to `api.ts` but unused here) — the kiosks endpoint already returns one row
 * per device with its current assignee (if any) and a completed-session
 * count merged in server-side, so there is nothing to cross-reference
 * client-side.
 */
export function CampaignAssignmentsPanel({ campaignId }: { campaignId: string }) {
  const [kiosks, setKiosks] = useState<CampaignKioskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<CampaignKioskSummary | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<CampaignKioskSummary | null>(null);

  const reload = () => {
    setError(null);
    listCampaignKiosks(campaignId)
      .then(setKiosks)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [campaignId]);

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {kiosks === null && !error && <p className="text-gray-500 text-sm">Đang tải...</p>}

      {kiosks !== null && kiosks.length === 0 && !error && (
        <p className="text-sm text-gray-500">
          Campaign này chưa có kiosk nào được thiết lập. Thiết bị tự xuất hiện ở đây sau khi kiosk tự đăng ký và
          chọn campaign này lần đầu.
        </p>
      )}

      {kiosks !== null && kiosks.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Kiosk</th>
              <th className="py-2.5 px-4">Trạng thái</th>
              <th className="py-2.5 px-4">Người được gán</th>
              <th className="py-2.5 px-4">Phiên hoàn thành</th>
              <th className="py-2.5 px-4">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {kiosks.map((k) => (
              <tr key={k.deviceId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-900 font-medium">{k.deviceName}</td>
                <td className="py-2.5 px-4 text-gray-500">{DEVICE_STATUS_LABEL[k.status] ?? k.status}</td>
                <td className="py-2.5 px-4 text-gray-900">
                  {k.assignedUserId ? (
                    <>
                      {k.assignedUserDisplayName ?? k.assignedUserEmail ?? k.assignedUserId}
                      {k.assignedUserDisplayName && k.assignedUserEmail && (
                        <div className="text-xs text-gray-500">{k.assignedUserEmail}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">Chưa gán</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-900 tabular-nums">{k.sessionsCompleted}</td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setAssignTarget(k)} className="text-blue-600 hover:text-blue-800 font-medium">
                      {k.assignedUserId ? 'Đổi người' : 'Gán'}
                    </button>
                    {k.assignedUserId && (
                      <button onClick={() => setUnassignTarget(k)} className="text-red-600 hover:text-red-800 font-medium">
                        Bỏ gán
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {assignTarget && (
        <AssignUserModal
          campaignId={campaignId}
          kiosk={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            setAssignTarget(null);
            reload();
          }}
        />
      )}

      {unassignTarget && (
        <UnassignModal
          campaignId={campaignId}
          kiosk={unassignTarget}
          onClose={() => setUnassignTarget(null)}
          onUnassigned={() => {
            setUnassignTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Search-as-you-type user picker (debounced 300ms against `GET /v1/users`).
 * A search error (e.g. 403 if the signed-in admin somehow lacks `user:read`)
 * surfaces inline rather than crashing the modal.
 */
function AssignUserModal({
  campaignId,
  kiosk,
  onClose,
  onAssigned,
}: {
  campaignId: string;
  kiosk: CampaignKioskSummary;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserListItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserListItem | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchError(null);
      listUsers({ q: q.trim() || undefined, limit: 20 })
        .then((res) => setResults(res.items))
        .catch((err) => setSearchError(err instanceof ApiError ? err.message : String(err)));
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      await assignCampaignKiosk(campaignId, kiosk.deviceId, selected.id, note.trim() || undefined);
      onAssigned();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Gán người vào "${kiosk.deviceName}"`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Tìm người dùng (email, tên, mã, hoặc SĐT)</label>
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
            }}
            placeholder="Nhập để tìm..."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            autoFocus
          />
        </div>

        {searchError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{searchError}</div>
        )}

        {!searchError && (
          <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {results === null && <p className="p-3 text-sm text-gray-500">Đang tải...</p>}
            {results !== null && results.length === 0 && (
              <p className="p-3 text-sm text-gray-500">Không tìm thấy người dùng nào.</p>
            )}
            {results?.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelected(u)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                  selected?.id === u.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="text-gray-900 font-medium">{u.displayName ?? u.email}</div>
                <div className="text-xs text-gray-500">
                  {u.email}
                  {u.code ? ` · ${u.code}` : ''}
                  {u.isAdmin ? ' · Admin' : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-500 mb-1">Ghi chú (tuỳ chọn)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>

        {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!selected || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang gán...' : 'Gán'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function UnassignModal({
  campaignId,
  kiosk,
  onClose,
  onUnassigned,
}: {
  campaignId: string;
  kiosk: CampaignKioskSummary;
  onClose: () => void;
  onUnassigned: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await unassignCampaignKiosk(campaignId, kiosk.deviceId);
      onUnassigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Bỏ gán "${kiosk.deviceName}"`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          {kiosk.assignedUserDisplayName ?? kiosk.assignedUserEmail ?? 'Người dùng hiện tại'} sẽ không còn được gán
          vào kiosk này trong campaign này.
        </p>
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang bỏ gán...' : 'Bỏ gán'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
