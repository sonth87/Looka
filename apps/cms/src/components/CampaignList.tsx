import { useEffect, useState } from 'react';
import { ApiError, Campaign, CampaignPurpose, createCampaign, listCampaigns } from '../api';

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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        purpose,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
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
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-50"
      >
        {saving ? 'Đang tạo...' : 'Tạo campaign'}
      </button>
    </form>
  );
}
