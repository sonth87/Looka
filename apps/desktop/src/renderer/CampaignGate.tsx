import { useCallback, useEffect, useState } from 'react';
import type { AppContentProps } from '@sonth87/device-layout';
import {
  CampaignHomeScreen,
  CampaignPickerScreen,
  CampaignSummary,
  CampaignWorkflowConfig,
  fetchCampaignConfig,
  getSettings,
  LoginScreen,
  selfEnrollDevice,
  type AuthenticatedIdentity,
} from '@face/ui';
import { SsoAuthClient } from './ssoAuthClient';

// Exported so `App.tsx` can read `getOperatorUserId()` directly when
// constructing `FaceCaptureApp`'s props — see that method's own doc comment.
// Unlike `campaignConfig`, the operator identity doesn't change per campaign
// selection (it's set once at login), so it doesn't need threading through
// this file's own `children(props, campaignConfig)` callback.
export const authClient = new SsoAuthClient();

/**
 * S1→S3 gate (ui-redesign-plan.md §3.8.1): Đăng nhập → Chọn campaign →
 * Trang campaign → (renders `children`, the existing capture app, only
 * once "Thực hiện chụp ảnh" is actually pressed). Wraps
 * `FaceCaptureAppWithFsSink` in `App.tsx` so nothing about the capture
 * pipeline itself changes — this only decides WHEN it mounts.
 *
 * Login is `SsoAuthClient` — real Microsoft 365 SSO via DNU's login
 * (`apps/desktop/src/main/ssoLogin.ts`'s `BrowserWindow`), the same SSO the
 * CMS itself logs into. `LoginScreen` renders its SSO-button variant
 * automatically because `SsoAuthClient` implements `ssoLogin()` — see
 * `packages/ui/src/lib/authClient.ts`'s own doc comment. Swap back to
 * `@face/ui`'s `DevAuthClient` here for local testing against a dev
 * `apps/api` with no real SSO configured (`ALLOW_UNAUTHENTICATED_ADMIN_DEV=true`).
 */
export function CampaignGate({
  children,
  contentProps,
}: {
  /**
   * `campaignId` (2026-09-09, CCCD-scan capture-identification feature) is
   * `campaign.id` below — only known inside this gate's own closure (the
   * campaign the operator picked and joined), threaded through the same way
   * `campaignConfig` already is, so `FaceCaptureApp.tsx`'s `handleCccdScan`
   * knows which roster to check a scanned CCCD number against. `null` only
   * momentarily (`started` cannot become true without `campaign` being
   * set — see the render logic below), never a real "no campaign" state
   * `FaceCaptureApp` needs to handle differently.
   */
  children: (
    props: AppContentProps,
    campaignConfig: CampaignWorkflowConfig | null,
    campaignId: string | null
  ) => React.ReactNode;
  contentProps: AppContentProps;
}) {
  const [identity, setIdentity] = useState<AuthenticatedIdentity | null>(() => authClient.getUser());
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [campaignConfig, setCampaignConfig] = useState<CampaignWorkflowConfig | null>(null);
  const [mappedCameraCount, setMappedCameraCount] = useState(0);
  const [sequencing, setSequencing] = useState<'sequential' | 'simultaneous'>('sequential');

  /**
   * Fetches this campaign's real capture config (steps, "quay video") via
   * the SSO-authenticated `GET /v1/campaigns/:id/config` — gated server-side
   * by `CampaignMemberGuard` on the same APPROVED-membership-of-an-OPEN-
   * campaign check `canCapture` below already required to enable this
   * button, so a failure here is a transient network issue, not an
   * authorization one. On failure, still proceeds with an explicit non-null
   * *empty* config (captureAngles: null → defaultWorkflow, recordVideo:
   * false) rather than `null` — passing `null` all the way to
   * `FaceCaptureApp` would make it fall back to the legacy per-device-secret
   * `getDeviceAccessStatus()` path, exactly the block this gate exists to
   * avoid now that campaign + login is the access model.
   */
  async function handleStartCapture() {
    if (!campaign) return;
    setStarting(true);
    try {
      const config = await fetchCampaignConfig(campaign.id, authClient.authHeaders());
      setCampaignConfig({ captureAngles: config.captureAngles, recordVideo: config.recordVideo === true });
    } catch (err) {
      console.error('[CampaignGate] fetchCampaignConfig failed, starting with defaultWorkflow:', err);
      setCampaignConfig({ captureAngles: null, recordVideo: false });
    } finally {
      setStarting(false);
      setStarted(true);
    }
  }

  const refreshDeviceState = useCallback(async () => {
    const faceAPI = (window as any).faceAPI;
    const mapping = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
    setMappedCameraCount(Object.keys(mapping).filter((k) => mapping[k]).length);
    const seq = await faceAPI?.getCaptureSequencing?.();
    if (seq) setSequencing(seq);
  }, []);

  useEffect(() => {
    void refreshDeviceState();
  }, [refreshDeviceState]);

  /**
   * Bridges this kiosk's SSO login/campaign choice to a device identity the
   * *separate*, still device-credential-gated stats/events pipeline
   * (`apps/desktop/src/main/statsEvents.ts`) needs — that pipeline predates
   * the SSO/campaign pivot and was never re-pointed at it, so without this a
   * kiosk running the new login flow has no device identity at all:
   * `SESSION_REPORT` events (what makes a captured session show up in the
   * CMS's photo-review list) silently never leave the machine, with no
   * error anywhere (2026-09-08 field report: "ấn lưu nhưng CMS không thấy
   * thông tin ảnh chụp").
   *
   * `POST /v1/devices/self-enroll` needs the SSO bearer token, which only
   * this renderer holds (`authClient`) — the main process supplies the
   * stable fingerprint/hostname, this call hits the API directly, and the
   * result goes back to the main process to persist via
   * `secrets.ts`'s `storeSelfEnrolledDevice` (same storage
   * `DeviceApiClient`/`statsEvents.ts` already read, so nothing else needs
   * to change for them to start working). Runs once per campaign selection,
   * not on every render — re-enrolling on an unrelated re-render would
   * needlessly rotate this kiosk's device secret. Never blocks the UI: a
   * failure here only means SESSION_REPORT keeps not reaching the server,
   * not that capture itself should be refused.
   */
  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    void (async () => {
      try {
        const faceAPI = (window as any).faceAPI;
        const info = await faceAPI?.getDeviceFingerprintInfo?.();
        if (!info || cancelled) return;
        const result = await selfEnrollDevice(
          { hostname: info.hostname, fingerprint: info.fingerprint, os: window.navigator.platform, campaignId: campaign.id },
          authClient.authHeaders()
        );
        if (cancelled) return;
        await faceAPI?.storeSelfEnrolledDevice?.(result);
      } catch (err) {
        console.error('[CampaignGate] self-enroll failed — SESSION_REPORT stats will keep failing to reach the server:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign?.id]);

  if (started && campaign) {
    return <>{children(contentProps, campaignConfig, campaign.id)}</>;
  }

  if (!identity) {
    return (
      <LoginScreen
        authClient={authClient}
        onLoggedIn={(id) => setIdentity(id)}
        deviceLabel={window.location.hostname || 'Máy này'}
      />
    );
  }

  if (!campaign) {
    return (
      <CampaignPickerScreen
        authClient={authClient}
        identity={identity}
        onSelectCampaign={(c) => setCampaign(c)}
        onLogout={() => {
          authClient.logout();
          setIdentity(null);
        }}
      />
    );
  }

  return (
    <CampaignHomeScreen
      campaign={campaign}
      mappedCameraCount={mappedCameraCount}
      sequencing={sequencing}
      captureMode={getSettings().captureMode ?? 'MANUAL'}
      onStartCapture={() => void handleStartCapture()}
      starting={starting}
      onOpenDeviceSettings={() => {
        (window as any).faceAPI?.openCameraSetup?.();
      }}
      onBack={() => setCampaign(null)}
    />
  );
}
