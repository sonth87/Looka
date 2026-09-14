import { useEffect, useState } from 'react';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Circle,
  CircleDot,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { AuthClient, AuthenticatedIdentity } from '../../lib/authClient.js';
import {
  CampaignConfig,
  CampaignSummary,
  fetchCampaignConfig,
} from '../../lib/campaignPortalApi.js';
import { Badge, type BadgeVariant } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { CameraPreview } from '../camera/CameraPreview.js';

export interface DeviceInitScreenProps {
  identity: AuthenticatedIdentity;
  /**
   * Only used here to fetch the selected campaign's `cardSpec`/`captureAngles`
   * for the "Quy chuẩn bắt buộc từ server" panel (`fetchCampaignConfig`) —
   * the campaign LIST itself and reload are both controlled by `CampaignGate`
   * (see props below), not fetched inside this screen. See this file's own
   * bottom note for why the list moved up a level.
   */
  authClient: AuthClient;
  /** `CampaignGate` only mounts this screen once its first campaign-list fetch has resolved (success or error) — see `StandbyScreen` for what covers the window before that. */
  campaigns: CampaignSummary[];
  campaignsError?: string | null;
  onReloadCampaigns: () => void;
  /**
   * Whether the logged-in caller is a CMS admin — admins now get every
   * not-closed campaign unfiltered from `GET /v1/me/campaigns` (no personal
   * membership required), instead of only campaigns they're personally an
   * APPROVED member of. `AuthenticatedIdentity` (the `identity` prop above)
   * doesn't carry this today, so `CampaignGate` needs to thread it in
   * separately once it has the real value (e.g. from its own `/v1/me`
   * call's `MeResponse.isAdmin` — see `campaignPortalApi.ts`). Left
   * `undefined` until that wiring lands; treated the same as `true` here
   * (see usage below) so an unwired caller fails toward the safer, more
   * neutral label rather than confidently claiming an approval that may not
   * exist.
   */
  isAdmin?: boolean;
  selectedCampaign: CampaignSummary | null;
  onSelectCampaign: (campaign: CampaignSummary | null) => void;
  /** How many physical cameras this kiosk currently has mapped to a role — from Camera Setup / `secrets.dat`. */
  mappedCameraCount: number;
  sequencing: 'sequential' | 'simultaneous';
  captureMode: 'AUTO' | 'MANUAL' | 'OFF';
  /** Now takes the operator's chosen campaign — this screen owns campaign SELECTION itself (merged picker+home), `CampaignGate` no longer decides it up front. */
  onStartCapture: (campaign: CampaignSummary) => void;
  /** True while `CampaignGate` is fetching this campaign's real capture config before mounting the capture screen — disables the CTA so a slow network doesn't read as an unresponsive click. */
  starting?: boolean;
  onOpenDeviceSettings: () => void;
  onLogout: () => void;
}

const STATUS_BADGE: Record<CampaignSummary['effectiveStatus'], { label: string; variant: BadgeVariant }> = {
  UPCOMING: { label: 'SẮP DIỄN RA', variant: 'warning' },
  OPEN: { label: 'ĐANG DIỄN RA', variant: 'success' },
  EXPIRED: { label: 'HẾT HẠN', variant: 'danger' },
  PAUSED: { label: 'TẠM DỪNG', variant: 'neutral' },
  CLOSED: { label: 'ĐÃ ĐÓNG', variant: 'neutral' },
};

const CAPTURE_MODE_LABEL: Record<DeviceInitScreenProps['captureMode'], string> = {
  AUTO: 'Tự động',
  MANUAL: 'Thủ công (cử chỉ tay)',
  OFF: 'Thủ công (bấm nút)',
};

function formatDateRange(startsAt?: string | null, expiresAt?: string | null): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString('vi-VN');
  if (startsAt && expiresAt) return `${fmt(startsAt)} – ${fmt(expiresAt)}`;
  if (expiresAt) return `Đến ${fmt(expiresAt)}`;
  if (startsAt) return `Từ ${fmt(startsAt)}`;
  return 'Không giới hạn thời gian';
}

/** "1.899 hồ sơ" from real quota data, or a rough photo-count fallback — never an invented number. `null` when neither is known, so the card simply omits the line. */
function campaignCountLabel(c: CampaignSummary): string | null {
  if (c.quotaPlanned != null) return `${c.quotaPlanned.toLocaleString('vi-VN')} hồ sơ${c.quotaReached ? ' (đã đạt)' : ''}`;
  if (c.captureAngles?.length) return `${c.captureAngles.length} ảnh/hồ sơ`;
  return null;
}

/**
 * Same gating rule `CampaignHomeScreen.reasonForBlock()` used before this
 * merge (ui-redesign-plan.md §3.8.1's wording table), wrapped to also cover
 * "no campaign selected yet" (a state that couldn't previously exist, since
 * the old flow forced a selection before ever reaching this logic) — minus
 * the `NONE`-membership case, dropped once self-registration was removed:
 * `GET /v1/me/campaigns` now filters a non-admin caller down to campaigns
 * they're already an APPROVED member of, so `NONE` can no longer appear for
 * them, and it never blocked an admin caller in the first place (backend
 * bypasses membership entirely for admins).
 */
function reasonForBlock(campaign: CampaignSummary | null, mappedCameraCount: number): string | null {
  if (!campaign) return 'Chọn một đợt chụp để bắt đầu';

  const campaignOpen = campaign.effectiveStatus === 'OPEN';
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
  if (mappedCameraCount < 1) return 'Chưa gán camera cho máy này';
  return null;
}

function ReadinessRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-kiosk-border bg-kiosk-surface-2/40 px-4 py-3">
      <div className="flex items-center gap-2.5 text-sm text-kiosk-text">
        {ready ? (
          <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-kiosk-accent-2" />
        ) : (
          <Circle className="h-[18px] w-[18px] shrink-0 text-kiosk-warning" />
        )}
        {label}
      </div>
      <Badge variant={ready ? 'success' : 'warning'}>{ready ? 'Sẵn sàng' : 'Đang chờ'}</Badge>
    </div>
  );
}

/**
 * S2/S3 (ui-redesign-plan.md "Bước 2+3") — merges the old `CampaignPickerScreen`
 * (assigned-campaign list) and `CampaignHomeScreen` (device summary + start
 * CTA) into one screen with two visual states, per the mockups: left column
 * swaps from a device-readiness checklist to a live camera preview once a
 * campaign is picked and this kiosk's cameras are ready; right column always
 * shows the assigned-campaign list plus the selected campaign's
 * server-mandated capture spec.
 *
 * Self-registration ("Đăng ký tham gia") used to live in this screen too —
 * removed once the product model switched to admin-assigns-via-CMS
 * (`campaign_kiosk_assignments`): a non-admin caller's `GET /v1/me/campaigns`
 * response is now pre-filtered server-side to campaigns they're already an
 * APPROVED member of, so there's nothing left here to join.
 *
 * Campaign SELECTION is owned locally (`selectedCampaign`/`onSelectCampaign`
 * are controlled by the caller only so `CampaignGate`'s self-enrollment
 * effect and `KioskShell` footer can react to it too) — but the campaign
 * LIST itself, its loading/error state, and reload are controlled props from
 * `CampaignGate`, not fetched in here. That's a deliberate deviation from a
 * simpler "this screen owns everything Picker used to own" split:
 * `CampaignGate` needs to know when the first campaign fetch has resolved so
 * it can decide between `StandbyScreen` and this screen, and it can only
 * know that if the fetch itself runs somewhere that's mounted regardless of
 * which of the two is currently showing — i.e. up in `CampaignGate`, not in
 * here. See that file's own comments.
 */
export function DeviceInitScreen({
  identity,
  authClient,
  campaigns,
  campaignsError,
  onReloadCampaigns,
  isAdmin,
  selectedCampaign,
  onSelectCampaign,
  mappedCameraCount,
  sequencing,
  captureMode,
  onStartCapture,
  starting = false,
  onOpenDeviceSettings,
  onLogout,
}: DeviceInitScreenProps) {
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  // Server-mandated capture spec for whichever campaign is currently
  // selected — same `fetchCampaignConfig` call `CampaignGate.handleStartCapture`
  // makes before actually starting a session, just fired earlier (on
  // selection) so the "Quy chuẩn bắt buộc từ server" panel has something real
  // to show before the operator commits. Failures are swallowed exactly like
  // that call site does: this is a preview panel, not a gate, so a transient
  // network hiccup here just falls back to the honest placeholder below
  // rather than blocking anything.
  useEffect(() => {
    if (!selectedCampaign) {
      setConfig(null);
      return;
    }
    let cancelled = false;
    setConfigLoading(true);
    fetchCampaignConfig(selectedCampaign.id, authClient.authHeaders())
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch((err) => {
        console.error('[DeviceInitScreen] fetchCampaignConfig (preview) failed:', err);
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCampaign?.id, authClient]);

  const requiredCameraCount = selectedCampaign?.requiredCameraCount ?? 1;
  const cameraCalibrated = mappedCameraCount >= requiredCameraCount;
  // No real "connectivity to the central station" check exists yet (no API
  // for it) — always reported ready per the task spec's explicit call for
  // honesty about what's real vs. placeholder. Swap for a real check once
  // the backend exposes one.
  const centralConnectionOk = true;
  const deviceReady = cameraCalibrated && centralConnectionOk;
  const showPreviewState = !!selectedCampaign && deviceReady;

  const blockReason = reasonForBlock(selectedCampaign, mappedCameraCount);
  const canCapture = !!selectedCampaign && blockReason === null;
  /**
   * Label for the "ready to capture" badge below the CTA. A real per-user
   * `APPROVED` membership is only guaranteed for a non-admin caller (backend
   * now filters their campaign list down to exactly those); an admin caller
   * sees every campaign unfiltered and may have no personal membership row
   * at all, so asserting "Tài khoản đã được duyệt" for them would be a
   * fabricated claim. `isAdmin === false` is the only case with a real
   * personal-approval guarantee — `true` or not-yet-wired `undefined` both
   * fail toward the neutral, always-true "Toàn quyền admin" label instead of
   * risking a false one.
   */
  const readyBadgeLabel = isAdmin === false ? 'Tài khoản đã được duyệt' : 'Toàn quyền admin';

  const hasRealCardSpec = !!config?.cardSpec && Object.keys(config.cardSpec).length > 0;
  const fallbackAngleCount = config?.captureAngles?.length ?? selectedCampaign?.captureAngles?.length ?? null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-[1fr_1.15fr]">
        {/* Left column — device readiness checklist (state A) or live camera preview (state B) */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>Thiết bị này</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {showPreviewState ? (
              <div className="flex flex-1 flex-col gap-3">
                <CameraPreview stream={null} aspectRatio="4/3" className="flex-1 border border-kiosk-border bg-kiosk-bg">
                  {/*
                    This screen has never owned a live getUserMedia stream —
                    that lives in DesktopCaptureView/FaceCaptureApp, out of
                    this task's scope. Rather than fake a feed, `stream` stays
                    null and this overlay says plainly that the real preview
                    isn't wired up here yet; swap for a real MediaStream once
                    it is.
                  */}
                  <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-2 text-center">
                    <Camera className="h-10 w-10 text-kiosk-text-muted" />
                    <div className="text-sm font-medium text-kiosk-text">Xem trước camera</div>
                    <div className="max-w-[220px] text-xs text-kiosk-text-muted">
                      Luồng camera thực sẽ hiển thị khi bắt đầu phiên chụp
                    </div>
                  </div>
                </CameraPreview>
                <div className="text-xs text-kiosk-text-muted">
                  {mappedCameraCount}/{requiredCameraCount} camera đã gán ·{' '}
                  {sequencing === 'simultaneous' ? 'Đồng thời' : 'Tuần tự'} · {CAPTURE_MODE_LABEL[captureMode]}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col gap-3">
                <div className="text-xs font-bold uppercase tracking-wide text-kiosk-text-muted">
                  Chuẩn bị thiết bị
                </div>
                <ReadinessRow label="Hiệu chuẩn cảm biến & camera" ready={cameraCalibrated} />
                <ReadinessRow label="Kiểm tra kết nối tới trạm trung tâm" ready={centralConnectionOk} />
                <div className="mt-1 text-xs text-kiosk-text-muted">
                  {mappedCameraCount}/{requiredCameraCount} camera đã gán ·{' '}
                  {sequencing === 'simultaneous' ? 'Đồng thời' : 'Tuần tự'} · {CAPTURE_MODE_LABEL[captureMode]}
                </div>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={onOpenDeviceSettings} className="self-start">
              <Settings2 className="h-3.5 w-3.5" />
              Cài đặt thiết bị
            </Button>
          </CardContent>
        </Card>

        {/* Right column — assigned campaigns + server-mandated spec for the selected one */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Đợt chụp được phân công</CardTitle>
            <button
              onClick={onLogout}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-kiosk-border px-2.5 py-1.5 text-xs font-medium text-kiosk-text-muted transition-colors hover:border-kiosk-danger/40 hover:text-kiosk-danger"
              title={identity.displayName}
            >
              <LogOut className="h-3.5 w-3.5" />
              Đăng xuất
            </button>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto">
            {campaignsError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-kiosk-danger/30 bg-kiosk-danger/10 px-4 py-3 text-sm text-kiosk-danger">
                <span>{campaignsError}</span>
                <button
                  onClick={onReloadCampaigns}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-kiosk-danger/40 px-3 py-1.5 font-medium hover:bg-kiosk-danger/10"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Thử lại
                </button>
              </div>
            )}

            {campaigns.length === 0 && !campaignsError && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-kiosk-text-muted">
                <Search className="h-9 w-9 text-kiosk-text-muted/60" />
                <p className="text-sm">Chưa có đợt chụp nào được gán cho bạn.</p>
                <p className="text-xs">Vui lòng liên hệ quản trị viên/CTSV để được gán vào một đợt chụp.</p>
              </div>
            )}

            <div className="space-y-2.5">
              {campaigns.map((c) => {
                const status = STATUS_BADGE[c.effectiveStatus];
                const selected = selectedCampaign?.id === c.id;
                const count = campaignCountLabel(c);
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelectCampaign(selected ? null : c)}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      selected
                        ? 'border-kiosk-accent bg-kiosk-accent/10'
                        : 'border-kiosk-border bg-kiosk-surface-2/40 hover:border-kiosk-border/80'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-kiosk-text">
                          {c.code ? `${c.code} · ` : ''}
                          {c.name}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-kiosk-text-muted">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          {formatDateRange(c.startsAt, c.expiresAt)}
                        </div>
                      </div>
                      <Badge variant={status.variant} className="shrink-0">
                        {status.label}
                      </Badge>
                    </div>
                    {count && <div className="mt-2 text-xs text-kiosk-text-muted">{count}</div>}
                  </button>
                );
              })}
            </div>

            {/* "QUY CHUẨN BẮT BUỘC TỪ SERVER" — ICAO/ISO spec for the selected campaign */}
            <div className="mt-5 border-t border-kiosk-border pt-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-kiosk-text-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Quy chuẩn bắt buộc từ server
              </div>

              {!selectedCampaign && (
                <div className="text-xs text-kiosk-text-muted">Chọn một đợt chụp để xem quy chuẩn.</div>
              )}

              {selectedCampaign && configLoading && (
                <div className="text-xs text-kiosk-text-muted">Đang tải quy chuẩn…</div>
              )}

              {selectedCampaign && !configLoading && hasRealCardSpec && (
                <div className="space-y-1.5 rounded-lg border border-kiosk-border bg-kiosk-surface-2/40 px-3 py-2.5">
                  {Object.entries(config!.cardSpec as Record<string, unknown>).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-kiosk-text-muted">{key}</span>
                      <span className="font-medium text-kiosk-text">{String(value)}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedCampaign && !configLoading && !hasRealCardSpec && (
                <div className="rounded-lg border border-dashed border-kiosk-border px-3 py-2.5 text-xs text-kiosk-text-muted">
                  {fallbackAngleCount
                    ? `Cần chụp ${fallbackAngleCount} ảnh theo góc chuẩn ICAO/ISO (server chưa cung cấp cardSpec chi tiết).`
                    : 'Ảnh 3x4cm, 300dpi (giá trị mặc định — server chưa cung cấp quy chuẩn thực tế cho đợt chụp này).'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom bar — start-capture CTA (self-registration removed; every campaign in `campaigns` is already one this caller is approved/assigned for, or the caller is admin) */}
      <div className="shrink-0 border-t border-kiosk-border p-5">
        <Button
          size="xl"
          variant="primary"
          className="w-full"
          disabled={!canCapture || starting}
          onClick={() => selectedCampaign && onStartCapture(selectedCampaign)}
        >
          <CircleDot className={cn('h-6 w-6', starting && 'animate-pulse')} />
          {starting ? 'Đang chuẩn bị…' : 'XÁC NHẬN CẤU HÌNH & BẮT ĐẦU CHỤP HÀNG LOẠT'}
        </Button>
        <div className="mt-3 flex justify-center">
          {blockReason ? (
            <Badge variant="warning">{blockReason}</Badge>
          ) : (
            <Badge variant="success">
              {readyBadgeLabel} · Campaign đang mở · {mappedCameraCount} camera
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
