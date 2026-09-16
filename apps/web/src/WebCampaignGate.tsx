import { useCallback, useEffect, useState } from 'react';
import {
  CampaignPortalApiError,
  CampaignSummary,
  CampaignWorkflowConfig,
  DeviceInitScreen,
  fetchCampaignConfig,
  fetchMe,
  fetchMyCampaigns,
  getSettings,
  LoginScreen,
  KioskShell,
  selfEnrollDevice,
  StandbyScreen,
  type AuthClient,
  type AuthenticatedIdentity,
} from '@face/ui';
import { WebAuthClient } from './webAuthClient';

/**
 * Browser counterpart to `apps/desktop`'s `CampaignGate.tsx` — same
 * Đăng nhập → Chờ → Chọn đợt chụp → chụp state machine and the SAME shared
 * `@face/ui` screens (`LoginScreen`/`StandbyScreen`/`DeviceInitScreen`/
 * `KioskShell`), but with every Electron-only piece removed:
 *  - No `window.faceAPI` — no camera-role mapping, no "Cài đặt thiết bị"
 *    separate window, no multi-camera preview grid. `apps/web` runs on a
 *    single browser/phone camera that `FaceCaptureApp` opens itself once
 *    capture actually starts — there is nothing to pre-configure, so
 *    `DeviceInitScreen` renders with `singleCameraMode` (hides its
 *    "Thiết bị này" panel entirely — see that component's own doc comment).
 *  - `authClient` is unconditionally `WebAuthClient` (full-page SSO
 *    redirect, see its own doc comment) — same as desktop's own
 *    `CampaignGate.tsx` unconditionally exporting `new SsoAuthClient()`,
 *    no manual name/email `DevAuthClient` fallback in the real flow.
 *  - Self-enrollment uses a browser-generated device id (`crypto.randomUUID()`,
 *    persisted in `localStorage` — the exact same "not derived from real
 *    hardware, just a persisted random id" shape desktop's own fingerprint
 *    already is, see `apps/desktop/src/main/secrets.ts`'s
 *    `getOrCreateDeviceFingerprint()`) instead of `faceAPI.getDeviceFingerprintInfo()`.
 */
export const authClient: AuthClient = new WebAuthClient();

const WEB_DEVICE_ID_STORAGE_KEY = 'looka_web_device_id_v1';

function getOrCreateWebDeviceId(): string {
  try {
    const existing = localStorage.getItem(WEB_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(WEB_DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private mode, etc.) — a fresh id every load
    // just means self-enrollment ties stats to a "new device" each time,
    // never blocks capture itself.
    return crypto.randomUUID();
  }
}

export function WebCampaignGate({
  children,
}: {
  /** Mirrors desktop's own `children` contract minus the Electron `AppContentProps` desktop threads through (nothing here needs it). */
  children: (campaignConfig: CampaignWorkflowConfig | null, campaignId: string | null) => React.ReactNode;
}) {
  const [identity, setIdentity] = useState<AuthenticatedIdentity | null>(() => authClient.getUser());
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [campaignConfig, setCampaignConfig] = useState<CampaignWorkflowConfig | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSummary | null>(null);

  /** Same reset `onLogout` used to do manually — see desktop's `CampaignGate.tsx`'s `forceLogout` for why every 401 handler below needs it too, not just the operator's own logout button. */
  const forceLogout = useCallback(() => {
    authClient.logout();
    setIdentity(null);
    setCampaigns(null);
    setCampaignsError(null);
    setSelectedCampaign(null);
    setIsAdmin(undefined);
  }, []);

  /** True for the one `CampaignPortalApiError` case that means "this SSO session is no longer valid" (vs. a network blip or a 5xx). */
  const isSessionExpired = (err: unknown): boolean => err instanceof CampaignPortalApiError && err.status === 401;

  const loadCampaigns = useCallback(async () => {
    setCampaignsError(null);
    try {
      const list = await fetchMyCampaigns(authClient.authHeaders());
      setCampaigns(list);
    } catch (err) {
      if (isSessionExpired(err)) {
        forceLogout();
        return;
      }
      setCampaignsError((err as Error).message);
      setCampaigns((prev) => prev ?? []);
    }
  }, [forceLogout]);

  useEffect(() => {
    if (!identity) return;
    void loadCampaigns();
  }, [identity, loadCampaigns]);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetchMe(authClient.authHeaders());
        if (!cancelled) setIsAdmin(me.isAdmin);
      } catch (err) {
        if (!cancelled && isSessionExpired(err)) {
          forceLogout();
          return;
        }
        console.error('[WebCampaignGate] fetchMe failed — isAdmin badge will stay unknown:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, forceLogout]);

  async function handleStartCapture(selected: CampaignSummary) {
    setCampaign(selected);
    setStarting(true);
    try {
      const config = await fetchCampaignConfig(selected.id, authClient.authHeaders());
      setCampaignConfig({
        captureAngles: config.captureAngles,
        recordVideo: config.recordVideo === true,
      });
    } catch (err) {
      if (isSessionExpired(err)) {
        forceLogout();
        return;
      }
      console.error('[WebCampaignGate] fetchCampaignConfig failed, starting with defaultWorkflow:', err);
      setCampaignConfig({ captureAngles: null, recordVideo: false });
    }
    setStarting(false);
    setStarted(true);
  }

  // Self-enrollment — same purpose as desktop's own (ties this browser to a
  // device identity the stats/events pipeline needs so a captured session
  // shows up in the CMS's photo-review list), just fed a browser-generated
  // id instead of `faceAPI.getDeviceFingerprintInfo()`. Never blocks the UI.
  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await selfEnrollDevice(
          {
            hostname: window.location.hostname || 'web',
            fingerprint: getOrCreateWebDeviceId(),
            os: navigator.platform,
            campaignId: campaign.id,
          },
          authClient.authHeaders()
        );
        if (cancelled) return;
        // Unlike desktop (which persists this via `faceAPI.storeSelfEnrolledDevice`
        // for the separate device-credential-gated stats pipeline), there is
        // no such second pipeline in `apps/web` to feed — the call itself
        // (tying this device id to the campaign server-side) is what
        // matters; nothing here needs the returned device secret.
        void result;
      } catch (err) {
        // Deliberately NOT `forceLogout()` here even on a 401 — same
        // reasoning as desktop's `CampaignGate.tsx`: `started` may already
        // be `true` by the time this resolves, and actual capture uploads
        // don't depend on this SSO token at all.
        console.error('[WebCampaignGate] self-enroll failed — SESSION_REPORT stats will keep failing to reach the server:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign?.id]);

  if (!identity) {
    return (
      <LoginScreen
        authClient={authClient}
        onLoggedIn={(id) => setIdentity(id)}
        deviceLabel={window.location.hostname || 'Trình duyệt'}
      />
    );
  }

  if (started && campaign) {
    return (
      <KioskShell
        systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên"
        operatorName={identity.displayName}
        // Same "back to campaign selection" behaviour as desktop's own
        // `CampaignGate.tsx` — was missing here entirely (2026-09-15 field
        // report). Leaves any in-progress capture session behind, so the
        // same confirm-first guard applies.
        onBack={() => {
          if (!window.confirm('Quay lại màn chọn đợt chụp? Phiên chụp đang dở sẽ không được lưu.')) return;
          setStarted(false);
          setCampaign(null);
          setCampaignConfig(null);
        }}
      >
        {children(campaignConfig, campaign.id)}
      </KioskShell>
    );
  }

  if (!campaigns) {
    return (
      <KioskShell systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên" operatorName={identity.displayName}>
        <StandbyScreen stationName={window.location.hostname || undefined} />
      </KioskShell>
    );
  }

  return (
    <KioskShell systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên" operatorName={identity.displayName}>
      <DeviceInitScreen
        identity={identity}
        authClient={authClient}
        isAdmin={isAdmin}
        singleCameraMode
        campaigns={campaigns}
        campaignsError={campaignsError}
        onReloadCampaigns={() => void loadCampaigns()}
        selectedCampaign={selectedCampaign}
        onSelectCampaign={setSelectedCampaign}
        mappedCameraCount={1}
        sequencing="sequential"
        captureMode={getSettings().captureMode ?? 'MANUAL'}
        onStartCapture={(c) => void handleStartCapture(c)}
        starting={starting}
        onOpenDeviceSettings={() => {}}
        onLogout={forceLogout}
      />
    </KioskShell>
  );
}
