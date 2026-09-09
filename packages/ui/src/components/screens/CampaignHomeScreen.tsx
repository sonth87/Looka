import { ArrowLeft, Images, Camera, Settings2, Repeat, MousePointerClick, CircleDot } from 'lucide-react';
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
 *
 * Redesigned 2026-09-09 (item 7) — same props/behaviour as before (no
 * change to `CampaignHomeScreenProps`, `reasonForBlock`'s wording, or the
 * gating logic), a kiosk-appropriate visual pass: bigger stat rows with
 * icons, a full-bleed hero CTA, and a clearer "why blocked" banner instead
 * of a single small centred line.
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
    <div className="w-full h-full flex flex-col items-center bg-slate-950 text-slate-100">
      <div className="flex w-full max-w-4xl flex-col">
        <header className="flex items-center gap-3 px-2 py-6">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            aria-label="Quay lại"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Chiến dịch</div>
            <div className="text-lg font-bold text-slate-100">
              {campaign.code ? `${campaign.code} · ` : ''}
              {campaign.name}
            </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 gap-5 px-2 pb-6 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">
              Campaign — chụp cái gì
            </div>
            <div className="space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Images className="h-4.5 w-4.5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {campaign.captureAngles?.length ?? '—'} ảnh
                  </div>
                  <div className="text-xs text-slate-500">Số ảnh cần chụp cho mỗi sinh viên</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Camera className="h-4.5 w-4.5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Cần tối đa {campaign.requiredCameraCount} camera
                  </div>
                  <div className="text-xs text-slate-500">
                    Chỉ tiêu: {campaign.quotaPlanned ?? '—'}
                    {campaign.quotaReached ? ' (đã đạt)' : ''}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Thiết bị này — chụp bằng gì
              </div>
              <button
                onClick={onOpenDeviceSettings}
                className="flex items-center gap-1 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Cài đặt
              </button>
            </div>
            <div className="space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Camera className="h-4.5 w-4.5" />
                </div>
                <div className="text-sm font-semibold text-slate-100">{mappedCameraCount} camera đã gán</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Repeat className="h-4.5 w-4.5" />
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  {sequencing === 'simultaneous' ? 'Đồng thời' : 'Tuần tự'}
                  {estimatedRounds != null && (
                    <span className="ml-1.5 font-normal text-slate-500">· {estimatedRounds} vòng / SV</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <MousePointerClick className="h-4.5 w-4.5" />
                </div>
                <div className="text-sm font-semibold text-slate-100">{CAPTURE_MODE_LABEL[captureMode]}</div>
              </div>
            </div>
          </section>
        </div>

        <div className="px-2 pb-8">
          <button
            onClick={onStartCapture}
            disabled={!canCapture || starting}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 text-xl font-bold text-white shadow-lg shadow-blue-950/50 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none"
          >
            <CircleDot className={`h-6 w-6 ${starting ? 'animate-pulse' : ''}`} />
            {starting ? 'Đang chuẩn bị…' : 'Thực hiện chụp ảnh'}
          </button>

          <div className="mt-3 text-center">
            {blockReason ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-400">
                {blockReason}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400">
                Tài khoản đã được duyệt · Campaign đang mở · {mappedCameraCount} camera
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
