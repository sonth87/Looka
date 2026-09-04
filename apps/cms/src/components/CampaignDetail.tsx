import { useEffect, useState } from 'react';
import {
  ApiError,
  Campaign,
  CaptureTriggerMode,
  DesktopOs,
  Device,
  getCampaign,
  listDevices,
  registerDevice,
  updateCampaign,
} from '../api';
import { StatsPanel } from './StatsPanel';

type StepType = 'FRONT' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

/**
 * Simple toggle only — matches the "chỉ bật/tắt trong 5 góc có sẵn" option
 * from docs/plans/multi-camera-device-management-discussion.md §3.6 open
 * question #13, not the free-form editor its other option describes. Pose
 * targets/instructions here are a deliberate copy of `defaultWorkflow` in
 * packages/ui/src/components/screens/FaceCaptureApp.tsx — the app already
 * falls back to that exact workflow when a campaign sets no `captureAngles`,
 * so a campaign that enables all 5 here produces the same steps whether or
 * not this form ever touched it.
 */
const CAPTURE_STEP_DEFS: Record<StepType, Record<string, unknown>> = {
  FRONT: {
    id: 'step-front',
    type: 'FRONT',
    instruction: 'Nhìn thẳng vào camera',
    pose: { yaw: { target: 0, tolerance: 12 }, pitch: { target: 0, tolerance: 12 }, roll: { target: 0, tolerance: 12 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  LEFT: {
    id: 'step-left',
    type: 'LEFT',
    instruction: 'Quay mặt sang trái (15° - 30°)',
    pose: { yaw: { target: -22.5, tolerance: 7.5 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  RIGHT: {
    id: 'step-right',
    type: 'RIGHT',
    instruction: 'Quay mặt sang phải (15° - 30°)',
    pose: { yaw: { target: 22.5, tolerance: 7.5 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  UP: {
    id: 'step-up',
    type: 'UP',
    instruction: 'Ngẩng đầu lên (15° - 35°)',
    pose: { pitch: { target: 25, tolerance: 10 } },
    capture: { enabled: true },
  },
  DOWN: {
    id: 'step-down',
    type: 'DOWN',
    instruction: 'Cúi đầu xuống (15° - 35°)',
    pose: { pitch: { target: -25, tolerance: 10 } },
    capture: { enabled: true },
  },
};

const STEP_LABELS: Record<StepType, string> = {
  FRONT: 'FRONT — nhìn thẳng',
  LEFT: 'LEFT — quay trái',
  RIGHT: 'RIGHT — quay phải',
  UP: 'UP — ngẩng lên',
  DOWN: 'DOWN — cúi xuống',
};

/** Every campaign's declared angles is either empty (app default = all 5) or a subset of the 5 fixed types above — CUSTOM angles aren't offered by this simple toggle editor. */
function enabledAnglesFromCampaign(campaign: Campaign): Set<StepType> {
  const angles = campaign.captureAngles;
  if (!angles || angles.length === 0) return new Set(Object.keys(CAPTURE_STEP_DEFS) as StepType[]);
  return new Set(angles.map((a) => a.type as StepType).filter((t) => t in CAPTURE_STEP_DEFS));
}

/** Triggers a real browser save — `<a download>` on an object URL, revoked right after. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CampaignDetail({ campaignId, onBack }: { campaignId: string; onBack: () => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    getCampaign(campaignId)
      .then(setCampaign)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    listDevices(campaignId)
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, [campaignId]);

  if (error) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!campaign) return <p className="text-gray-500">Đang tải...</p>;

  return (
    <div>
      <button onClick={onBack} className="text-gray-500 hover:text-gray-700 mb-4 text-sm">
        ← Danh sách campaign
      </button>
      <h1 className="text-2xl font-bold mb-6 text-gray-900">{campaign.name}</h1>

      <div className="mb-6">
        <StatsPanel campaignId={campaignId} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CampaignSettingsForm campaign={campaign} onSaved={reload} />
        <DevicesPanel campaignId={campaignId} devices={devices} onChanged={reload} />
      </div>
    </div>
  );
}

function CampaignSettingsForm({ campaign, onSaved }: { campaign: Campaign; onSaved: () => void }) {
  const [expiresAt, setExpiresAt] = useState(campaign.expiresAt ? campaign.expiresAt.slice(0, 10) : '');
  const [consentContent, setConsentContent] = useState(campaign.consentContent ?? '');
  const [captureMode, setCaptureMode] = useState<CaptureTriggerMode | ''>(campaign.captureMode ?? '');
  const [enabledAngles, setEnabledAngles] = useState<Set<StepType>>(() => enabledAnglesFromCampaign(campaign));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleAngle = (type: StepType) => {
    if (type === 'FRONT') return; // always on — see the checkbox's own note below
    setEnabledAngles((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateCampaign(campaign.id, {
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        consentContent: consentContent || undefined,
        captureAngles: (Object.keys(CAPTURE_STEP_DEFS) as StepType[])
          .filter((type) => enabledAngles.has(type))
          .map((type) => CAPTURE_STEP_DEFS[type]),
        captureMode: captureMode || undefined,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3 h-fit">
      <h2 className="font-semibold text-gray-900">Cấu hình campaign</h2>

      <div>
        <label className="block text-sm text-gray-500 mb-1">
          Hạn dùng (để trống = vĩnh viễn — áp dụng cho mọi thiết bị trong campaign)
        </label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-500 mb-1">
          Nội dung consent (v{campaign.consentVersion}) — sửa sẽ tăng version
        </label>
        <textarea
          value={consentContent}
          onChange={(e) => setConsentContent(e.target.value)}
          rows={4}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-500 mb-1">Chế độ chụp</label>
        <select
          value={captureMode}
          onChange={(e) => setCaptureMode(e.target.value as CaptureTriggerMode | '')}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">Mặc định của app (MANUAL)</option>
          <option value="MANUAL">MANUAL — bấm nút chụp</option>
          <option value="AUTO">AUTO — tự chụp khi giữ đúng tư thế</option>
        </select>
      </div>

      <div>
        <label className="block text-sm text-gray-500 mb-1">Góc chụp (FRONT luôn bắt buộc — ảnh chính dùng để in)</label>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(CAPTURE_STEP_DEFS) as StepType[]).map((type) => (
            <label
              key={type}
              className={`flex items-center gap-1.5 text-sm ${type === 'FRONT' ? 'text-gray-400' : 'text-gray-700'}`}
            >
              <input
                type="checkbox"
                checked={enabledAngles.has(type)}
                disabled={type === 'FRONT'}
                onChange={() => toggleAngle(type)}
                className="rounded border-gray-300"
              />
              {STEP_LABELS[type]}
            </label>
          ))}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
        >
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
        {saved && <span className="text-emerald-600 text-sm">Đã lưu</span>}
      </div>
    </form>
  );
}

function DevicesPanel({
  campaignId,
  devices,
  onChanged,
}: {
  campaignId: string;
  devices: Device[];
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [authApiEndpoint, setAuthApiEndpoint] = useState('');
  const [os, setOs] = useState<DesktopOs>('mac');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setRegistering(true);
    setError(null);
    try {
      const { blob, filename } = await registerDevice(campaignId, {
        name: name.trim(),
        authApiEndpoint: authApiEndpoint.trim() || undefined,
        os,
      });
      saveBlob(blob, filename);
      setName('');
      setAuthApiEndpoint('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900">Thiết bị ({devices.length})</h2>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3">Tên</th>
            <th className="py-2 pr-3">Trạng thái</th>
            <th className="py-2 pr-3">Kích hoạt lúc</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-900">{d.name}</td>
              <td className="py-2 pr-3">
                <span
                  className={
                    d.status === 'ACTIVATED'
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }
                >
                  {d.status === 'ACTIVATED' ? 'Đã kích hoạt' : 'Chưa kích hoạt'}
                </span>
              </td>
              <td className="py-2 pr-3 text-gray-500">
                {d.activatedAt ? new Date(d.activatedAt).toLocaleString('vi-VN') : '—'}
              </td>
            </tr>
          ))}
          {devices.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-gray-500">
                Chưa có thiết bị nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={submit} className="space-y-3 pt-3 border-t border-gray-200">
        <h3 className="text-sm font-medium text-gray-700">Đăng ký thiết bị mới</h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên thiết bị (VD: Kiosk sảnh A)"
          required
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <input
          value={authApiEndpoint}
          onChange={(e) => setAuthApiEndpoint(e.target.value)}
          placeholder="API endpoint lấy thông tin xác thực (tuỳ chọn)"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
        />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hệ điều hành kiosk</label>
          <select
            value={os}
            onChange={(e) => setOs(e.target.value as DesktopOs)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="mac">macOS</option>
            <option value="win">Windows</option>
          </select>
        </div>
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={registering}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
        >
          {registering ? 'Đang tạo gói kích hoạt...' : 'Đăng ký & tải gói kích hoạt'}
        </button>
      </form>
    </div>
  );
}
