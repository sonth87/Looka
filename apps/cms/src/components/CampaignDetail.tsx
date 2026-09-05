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
import { CAPTURE_STEP_DEFS, StepType, enabledAnglesFromCampaign } from '../captureAngles';
import { CaptureFramesEditor } from './CaptureFramesEditor';
import { StatsPanel } from './StatsPanel';

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
      <div className="flex items-center gap-2 mb-6">
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
      </div>

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
  const [simultaneous, setSimultaneous] = useState(campaign.simultaneousCapture ?? false);
  const [recordVideo, setRecordVideo] = useState(campaign.recordVideo ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooFewFrames) return;
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
        simultaneousCapture: simultaneous,
        recordVideo,
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
        {/*
          Labels below match CaptureTriggerEvaluator.evaluate exactly — the
          previous copy here called MANUAL "bấm nút chụp" (shutter-button),
          which is actually what OFF does; MANUAL is the held hand-gesture
          trigger. That mismatch is the root cause behind the 2026-09-05 kiosk
          bug (a campaign set to OFF showed no shutter button at all): an
          admin picking a mode by this label got a different behavior than
          the name promised. See docs/ROADMAP.md §3's "naming trap" entry.
        */}
        <select
          value={captureMode}
          onChange={(e) => setCaptureMode(e.target.value as CaptureTriggerMode | '')}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
        >
          <option value="">Mặc định của app (theo cấu hình từng máy)</option>
          <option value="AUTO">Tự động (giữ đúng tư thế)</option>
          <option value="MANUAL">Cử chỉ tay (giơ tay để chụp)</option>
          <option value="OFF">Bấm nút chụp (thủ công)</option>
        </select>
      </div>

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

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || tooFewFrames}
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
