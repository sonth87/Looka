import { useEffect, useState } from 'react';
import { ApiError, Campaign, CampaignPurpose, createCampaign, listCampaigns } from '../api';
import { CAPTURE_STEP_DEFS, StepType } from '../captureAngles';
import { CaptureFramesEditor } from './CaptureFramesEditor';

const PURPOSE_LABEL: Record<CampaignPurpose, string> = {
  STUDENT_CARD: 'Chụp thẻ SV',
  KYC_ENROLLMENT: 'Đăng ký KYC/FaceID',
};

function formatExpiry(campaign: Campaign): string {
  if (!campaign.expiresAt) return 'Vĩnh viễn';
  return new Date(campaign.expiresAt).toLocaleDateString('vi-VN');
}

export function CampaignList({ onOpenCampaign }: { onOpenCampaign: (id: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = () => {
    listCampaigns()
      .then(setCampaigns)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  };

  useEffect(reload, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
        >
          {showCreate ? 'Đóng' : '+ Tạo campaign'}
        </button>
      </div>

      {showCreate && (
        <CreateCampaignForm
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 mb-4">{error}</div>}

      {campaigns === null && !error && <p className="text-gray-500">Đang tải...</p>}

      {campaigns && campaigns.length === 0 && <p className="text-gray-500">Chưa có campaign nào.</p>}

      {campaigns && campaigns.length > 0 && (
        <table className="w-full text-sm border-collapse bg-white rounded-xl border border-gray-200 overflow-hidden">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-4">Tên</th>
              <th className="py-2.5 px-4">Mục đích</th>
              <th className="py-2.5 px-4">Hạn dùng</th>
              <th className="py-2.5 px-4">Consent v.</th>
              <th className="py-2.5 px-4">Chế độ chụp</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2.5 px-4 font-medium text-gray-900">{c.name}</td>
                <td className="py-2.5 px-4 text-gray-500">{PURPOSE_LABEL[c.purpose]}</td>
                <td className="py-2.5 px-4 text-gray-500">{formatExpiry(c)}</td>
                <td className="py-2.5 px-4 text-gray-500">{c.consentVersion}</td>
                <td className="py-2.5 px-4">
                  <div className="flex flex-wrap gap-1">
                    {c.simultaneousCapture && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
                        Đồng thời
                      </span>
                    )}
                    {c.recordVideo && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                        Quay video
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-4 text-right">
                  <button onClick={() => onOpenCampaign(c.id)} className="text-blue-600 hover:text-blue-800 font-medium">
                    Xem →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState<CampaignPurpose>('STUDENT_CARD');
  const [expiresAt, setExpiresAt] = useState('');
  const [enabledAngles, setEnabledAngles] = useState<Set<StepType>>(
    () => new Set(Object.keys(CAPTURE_STEP_DEFS) as StepType[])
  );
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || tooFewFrames) return;
    setSaving(true);
    setError(null);
    try {
      await createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        purpose,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        captureAngles: (Object.keys(CAPTURE_STEP_DEFS) as StepType[])
          .filter((type) => enabledAngles.has(type))
          .map((type) => CAPTURE_STEP_DEFS[type]),
        simultaneousCapture: simultaneous,
        recordVideo,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
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
      <button
        type="submit"
        disabled={saving || tooFewFrames}
        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
      >
        {saving ? 'Đang tạo...' : 'Tạo campaign'}
      </button>
    </form>
  );
}
