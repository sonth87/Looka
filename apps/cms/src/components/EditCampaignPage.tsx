import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, Campaign, CaptureTriggerMode, getCampaign, updateCampaign } from '../api';
import { CAPTURE_STEP_DEFS, StepType, enabledAnglesFromCampaign } from '../captureAngles';
import { CaptureFramesEditor } from './CaptureFramesEditor';

/**
 * Dedicated edit page (`/campaigns/:id/edit`) — moved out of
 * `CampaignDetail`'s former `CampaignSettingsForm` (Part 4 of the
 * 2026-09-07 redesign, see docs/ROADMAP.md). `CampaignDetail` is now
 * read-only; every setting edit happens here, then navigates back to the
 * view page (`/campaigns/:id`) on save. "Huỷ" does the same, without saving.
 */
export function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getCampaign(id)
      .then(setCampaign)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [id]);

  if (error) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!campaign) return <p className="text-gray-500">Đang tải...</p>;

  return (
    <div className="max-w-2xl">
      <Link to={`/campaigns/${campaign.id}`} className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← {campaign.name}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Sửa campaign</h1>

      <CampaignSettingsForm campaign={campaign} onSaved={() => navigate(`/campaigns/${campaign.id}`)} />
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
    if (tooFewFrames) return;
    setSaving(true);
    setError(null);
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
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm space-y-3">
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
        <Link to={`/campaigns/${campaign.id}`} className="text-sm text-gray-500 hover:text-gray-700">
          Huỷ
        </Link>
      </div>
    </form>
  );
}
