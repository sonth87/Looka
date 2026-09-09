import type { CampaignSummary } from '../../lib/campaignPortalApi.js';

export interface CampaignHomeScreenProps {
  campaign: CampaignSummary;
  /** How many physical cameras this kiosk currently has mapped to a role — from Camera Setup / `secrets.dat`. */
  mappedCameraCount: number;
  sequencing: 'sequential' | 'simultaneous';
  captureMode: 'AUTO' | 'MANUAL' | 'OFF';
  /** Rounds the round-planner computed for this campaign's angle list against this kiosk's mapped cameras, if known yet. */
  estimatedRounds?: number | null;
  onStartCapture: () => void;
  /** True while `CampaignGate` is fetching this campaign's real capture config before mounting the capture screen — disables the button so a slow network doesn't read as an unresponsive click. */
  starting?: boolean;
  onOpenDeviceSettings: () => void;
  onBack: () => void;
}

const CAPTURE_MODE_LABEL: Record<CampaignHomeScreenProps['captureMode'], string> = {
  AUTO: 'Tự động',
  MANUAL: 'Thủ công (cử chỉ tay)',
  OFF: 'Thủ công (bấm nút)',
};

/**
 * S3 (ui-redesign-plan.md §2) — the single gate into a capture session.
 * Two blocks per the spec: left "CAMPAIGN" (what to shoot, from the
 * server), right "THIẾT BỊ NÀY" (how this kiosk shoots it, entirely
 * local). The action button is gated on all three conditions at once and
 * always shows why when it can't be pressed — see §3.8.1's exact wording
 * table, mirrored in `reasonForBlock` below.
 */
export function CampaignHomeScreen({
  campaign,
  mappedCameraCount,
  sequencing,
  captureMode,
  estimatedRounds,
  onStartCapture,
  starting = false,
  onOpenDeviceSettings,
  onBack,
}: CampaignHomeScreenProps) {
  const campaignOpen = campaign.effectiveStatus === 'OPEN';
  const approved = campaign.membership.status === 'APPROVED';
  const hasCamera = mappedCameraCount >= 1;
  const canCapture = campaignOpen && approved && hasCamera;

  function reasonForBlock(): string | null {
    if (!campaignOpen) {
      if (campaign.effectiveStatus === 'UPCOMING') {
        const date = campaign.startsAt ? new Date(campaign.startsAt).toLocaleString('vi-VN') : '';
        return `Campaign chưa mở${date ? ` — mở ngày ${date}` : ''}`;
      }
      if (campaign.effectiveStatus === 'EXPIRED') return 'Campaign đã hết hạn';
      if (campaign.effectiveStatus === 'PAUSED') return 'Campaign đang tạm dừng';
      return 'Campaign đã đóng';
    }
    if (campaign.membership.status === 'PENDING') return 'Tài khoản chưa được phê duyệt — đã gửi yêu cầu';
    if (campaign.membership.status === 'REJECTED') return 'Yêu cầu tham gia đã bị từ chối';
    if (campaign.membership.status === 'REVOKED') return 'Quyền tham gia đã bị thu hồi';
    if (campaign.membership.status === 'NONE') return 'Chưa đăng ký tham gia campaign này';
    if (!hasCamera) return 'Chưa gán camera cho máy này';
    return null;
  }

  const blockReason = reasonForBlock();

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-200">
          ←
        </button>
        <div className="font-semibold">{campaign.code ? `${campaign.code} · ` : ''}{campaign.name}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Campaign (chụp cái gì)</div>
          <div className="text-sm text-slate-300 space-y-1">
            <div>Chỉ tiêu: {campaign.quotaPlanned ?? '—'}{campaign.quotaReached ? ' (đã đạt)' : ''}</div>
            <div>
              {/* BUG FIX (2026-09-08): this used to show requiredCameraCount
                  for BOTH numbers — "5 ảnh · cần tối đa 5 camera" was never
                  actually the photo count, just the camera count printed
                  twice. captureAngles.length is the real "số ảnh cần chụp". */}
              {campaign.captureAngles?.length ?? '—'} ảnh · cần tối đa {campaign.requiredCameraCount} camera
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Thiết bị này (chụp bằng gì)</div>
          <div className="text-sm text-slate-300 space-y-1">
            <div>{mappedCameraCount} camera đã gán</div>
            <div>Cách chụp: {sequencing === 'simultaneous' ? 'Đồng thời' : 'Tuần tự'}</div>
            <div>Kích hoạt: {CAPTURE_MODE_LABEL[captureMode]}</div>
            {estimatedRounds != null && <div>Dự kiến: {estimatedRounds} vòng / SV</div>}
          </div>
          <button
            onClick={onOpenDeviceSettings}
            className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Cài đặt thiết bị
          </button>
        </div>
      </div>

      <div className="px-6 pb-6 max-w-3xl">
        <button
          onClick={onStartCapture}
          disabled={!canCapture || starting}
          className="w-full rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-lg py-4 transition-colors"
        >
          {starting ? 'Đang chuẩn bị…' : '● Thực hiện chụp ảnh'}
        </button>
        <div className="mt-2 text-center text-sm">
          {blockReason ? (
            <span className="text-amber-400">✖ {blockReason}</span>
          ) : (
            <span className="text-emerald-400">
              ✔ Tài khoản đã được duyệt · Campaign đang mở · {mappedCameraCount} camera
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
