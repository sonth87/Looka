import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContentProps } from '@sonth87/device-layout';
import {
  CAMERA_ROLE_LABELS_VI,
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
  type AuthenticatedIdentity,
  type KioskCameraStatus,
} from '@face/ui';
import { SsoAuthClient } from './ssoAuthClient';

/** Stable role display order for the `KioskShell` footer's camera chips — mirrors `CAMERA_ROLE_LABELS_VI`'s own key order (CENTER/LEFT/RIGHT/UP/DOWN). */
const CAMERA_ROLE_ORDER = Object.keys(CAMERA_ROLE_LABELS_VI) as Array<keyof typeof CAMERA_ROLE_LABELS_VI>;

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
   * `campaignConfig` already is. `FaceCaptureApp.tsx` uses its (and
   * `authClient`'s) mere presence purely to pick which pre-session
   * identification screen to show — `CccdScanWaitingScreen` on this
   * campaign+login path vs. `StudentIdEntryScreen`'s manual form on
   * `apps/web`/the legacy path — never to scope a roster lookup: the roster
   * (`D:\Work\camera_server\response.json`) is a single, campaign-agnostic
   * file the kiosk's main process checks a scanned CCCD against directly
   * (see `apps/desktop/src/main/cccdRosterWatcher.ts`), a 2026-09-09
   * same-day architecture correction from an earlier, wrongly campaign-
   * scoped Postgres roster. `null` only momentarily (`started` cannot
   * become true without `campaign` being set — see the render logic below),
   * never a real "no campaign" state `FaceCaptureApp` needs to handle
   * differently.
   */
  children: (
    props: AppContentProps,
    campaignConfig: CampaignWorkflowConfig | null,
    campaignId: string | null
  ) => React.ReactNode;
  contentProps: AppContentProps;
}) {
  const [identity, setIdentity] = useState<AuthenticatedIdentity | null>(() => authClient.getUser());
  /**
   * Whether the logged-in SSO user is an admin — `AuthenticatedIdentity`
   * (from `authClient.getUser()`) only carries `displayName`/`email`, not
   * this, so it's fetched separately via `GET /v1/me` once `identity` is
   * known. Threaded into `DeviceInitScreen` so it can show an "admin" badge
   * instead of a personal-approval one for campaigns the admin may not
   * hold an `APPROVED` membership row for (the backend already lets admins
   * see/act on every campaign regardless of membership — this is display
   * only, not an access decision). `undefined` while loading.
   */
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  /** The campaign the operator has actually committed to capture with (set inside `handleStartCapture`, once the "XÁC NHẬN CẤU HÌNH…" CTA is pressed) — NOT the same as `DeviceInitScreen`'s own `selectedCampaign` browsing state below. */
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [campaignConfig, setCampaignConfig] = useState<CampaignWorkflowConfig | null>(null);
  const [mappedCameraCount, setMappedCameraCount] = useState(0);
  const [cameraRoleMapping, setCameraRoleMapping] = useState<Record<string, string>>({});
  const [sequencing, setSequencing] = useState<'sequential' | 'simultaneous'>('sequential');
  /**
   * deviceIds `navigator.mediaDevices.enumerateDevices()` currently reports
   * as plugged in — a role being present in `cameraRoleMapping` only means
   * it was ASSIGNED to some deviceId in Camera Setup at some point, not that
   * the camera is physically connected right now (e.g. only the center
   * camera is plugged in today, but LEFT/RIGHT still have a stale mapping
   * from a previous setup) — the `KioskShell` footer's "ready" dot must
   * reflect this, not just config presence, or it lies (2026-09-15 field
   * report: all 3 role chips showed green with only 1 camera attached).
   */
  const [connectedDeviceIds, setConnectedDeviceIds] = useState<Set<string>>(new Set());
  /**
   * Live preview streams for `DeviceInitScreen`'s "Thiết bị này" panel, one
   * per mapped+connected camera role (2026-09-15 — that panel previously
   * always showed a single-camera placeholder). Keyed by role (CENTER/LEFT/
   * RIGHT/UP/DOWN) so `DeviceInitScreen` can build a per-campaign
   * `MultiFrameGrid` showing exactly the roles that campaign needs, live
   * video for whichever are connected and "chưa kết nối" for the rest.
   * Only populated while `!started`, so every handle is released before
   * `FaceCaptureApp`/`DesktopCaptureView` opens its own streams for the same
   * physical devices — holding both open at once risks the OS/driver
   * treating a camera as busy.
   */
  const [previewStreams, setPreviewStreams] = useState<Record<string, MediaStream>>({});
  /** `{deviceId: stream}` for whatever's currently open — one entry per PHYSICAL device (not per role, so two roles sharing one camera share one open session too), kept in a ref so the sync effect can diff against "what's actually open" without depending on its own previous state (which would need to be a dependency, causing an infinite loop). `previewStreams` (role-keyed, what `DeviceInitScreen` actually consumes) is derived from this each run. */
  const openPreviewStreamsRef = useRef<Record<string, MediaStream>>({});

  /**
   * Assigned-campaign list + browsing selection for the merged
   * `DeviceInitScreen` (formerly `CampaignPickerScreen` + `CampaignHomeScreen`).
   * Lives here, not inside `DeviceInitScreen` itself, so this gate can tell
   * when the FIRST fetch has resolved and switch from `StandbyScreen` to
   * `DeviceInitScreen` — `DeviceInitScreen` can't report that itself if it
   * isn't mounted yet while `StandbyScreen` is showing. `campaigns === null`
   * is the "still loading" signal; once it settles (success OR error) it
   * becomes a real array and this gate never shows `StandbyScreen` again for
   * the rest of the session (`DeviceInitScreen` renders its own retry banner
   * for later failures instead).
   */
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSummary | null>(null);

  const loadCampaigns = useCallback(async () => {
    setCampaignsError(null);
    try {
      const list = await fetchMyCampaigns(authClient.authHeaders());
      setCampaigns(list);
    } catch (err) {
      const message =
        err instanceof CampaignPortalApiError && err.status === 401
          ? 'Không xác thực được với máy chủ (SSO chưa sẵn sàng hoặc phiên đã hết hạn).'
          : (err as Error).message;
      setCampaignsError(message);
      // Still flips `campaigns` from `null` to a (empty) array — a failed
      // first fetch is not "still loading", it's a resolved state with an
      // error, and `DeviceInitScreen`'s own retry banner (wired to
      // `loadCampaigns` again below) is what should handle it from here,
      // not an indefinite `StandbyScreen`.
      setCampaigns((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    if (!identity) return;
    void loadCampaigns();
  }, [identity, loadCampaigns]);

  // 2026-09-14 assignment-model change: no more self-join, so the only
  // thing this gate still needs from `/v1/me` is the `isAdmin` flag (the
  // campaign list itself already comes back correctly scoped from
  // `fetchMyCampaigns` — the backend does the admin-vs-assigned filtering).
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetchMe(authClient.authHeaders());
        if (!cancelled) setIsAdmin(me.isAdmin);
      } catch (err) {
        console.error('[CampaignGate] fetchMe failed — isAdmin badge will stay unknown:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

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
   *
   * Takes the chosen campaign as a parameter (2026-09-14 Standby/DeviceInit
   * merge) — `DeviceInitScreen` now owns campaign SELECTION itself, so this
   * gate only learns which campaign to start with at the moment the operator
   * actually presses the CTA, not earlier.
   */
  async function handleStartCapture(selected: CampaignSummary) {
    setCampaign(selected);
    setStarting(true);
    try {
      const config = await fetchCampaignConfig(selected.id, authClient.authHeaders());
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
    setCameraRoleMapping(mapping);
    setMappedCameraCount(Object.keys(mapping).filter((k) => mapping[k]).length);
    const seq = await faceAPI?.getCaptureSequencing?.();
    if (seq) setSequencing(seq);
  }, []);

  useEffect(() => {
    void refreshDeviceState();
  }, [refreshDeviceState]);

  // Live camera presence for the footer's "ready" dots — separate from
  // `refreshDeviceState` above, which only reads saved config. Refreshes on
  // mount and whenever a camera is plugged/unplugged.
  useEffect(() => {
    let cancelled = false;
    async function refreshConnectedDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setConnectedDeviceIds(new Set(devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId)));
      } catch (err) {
        console.error('[CampaignGate] enumerateDevices failed — footer camera status may be stale:', err);
      }
    }
    void refreshConnectedDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshConnectedDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refreshConnectedDevices);
    };
  }, []);

  // Opens/closes one preview stream per mapped+connected camera role for
  // `DeviceInitScreen`'s multi-camera grid — see `previewStreams`'s own doc
  // comment. Diffs against `openPreviewStreamsRef` so a role whose device
  // hasn't changed keeps its existing stream instead of restarting it on
  // every unrelated re-run (e.g. `connectedDeviceIds` updating because a
  // DIFFERENT role's camera was plugged in).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const wanted: Record<string, string> = started
        ? {}
        : Object.fromEntries(
            Object.entries(cameraRoleMapping).filter(([, deviceId]) => deviceId && connectedDeviceIds.has(deviceId))
          );

      // Keyed by deviceId, not role — 2026-09-15 field report: two roles
      // (LEFT + RIGHT) mapped to the SAME physical camera (operator only had
      // one spare, or a Camera Setup mistake) both showed "Thiếu camera" even
      // though `enumerateDevices()` correctly reported it connected. Opening
      // one `getUserMedia` session per ROLE meant the second concurrent open
      // of the identical deviceId hit the same "one exclusive reader" limit
      // most UVC webcam drivers have (documented in `multiFrame.ts`'s own
      // `NotReadableError: Device in use` comment) and silently failed.
      // Opening at most once PER DEVICE and sharing that stream across every
      // role pointing at it sidesteps the contention entirely — if two roles
      // really do share one camera, both tiles now show the same live feed
      // (an honest signal something's misconfigured) instead of one or both
      // reading as disconnected.
      const open = openPreviewStreamsRef.current;
      const uniqueDeviceIds = Array.from(new Set(Object.values(wanted)));

      for (const deviceId of Object.keys(open)) {
        if (!uniqueDeviceIds.includes(deviceId)) {
          open[deviceId].getTracks().forEach((t) => t.stop());
          delete open[deviceId];
        }
      }

      for (const deviceId of uniqueDeviceIds) {
        if (open[deviceId]) continue;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          open[deviceId] = stream;
        } catch (err) {
          console.error(`[CampaignGate] getUserMedia (device-init preview, deviceId=${deviceId}) failed:`, err);
        }
      }

      if (!cancelled) {
        setPreviewStreams(
          Object.fromEntries(
            Object.entries(wanted)
              .filter(([, deviceId]) => open[deviceId])
              .map(([role, deviceId]) => [role, open[deviceId]])
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraRoleMapping, connectedDeviceIds, started]);

  // Stops every still-open preview stream on unmount only (the effect above
  // already handles closing individual ones as roles/devices change or
  // `started` flips true — this is just the final safety net).
  useEffect(() => {
    return () => {
      Object.values(openPreviewStreamsRef.current).forEach((stream) => stream.getTracks().forEach((t) => t.stop()));
      openPreviewStreamsRef.current = {};
    };
  }, []);

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
   * to change for them to start working). Runs once per `campaign` change —
   * which, since the Standby/DeviceInit merge (2026-09-14), is set inside
   * `handleStartCapture` (the operator has just pressed the start CTA)
   * rather than at browsing-selection time as before; it now fires
   * concurrently with that same function's `fetchCampaignConfig` call
   * instead of ahead of it. Neither call was ever awaited by the other, and
   * `started` flips regardless of this effect's outcome, so this is a timing
   * change only, not a behavioural one. Never blocks the UI: a failure here
   * only means SESSION_REPORT keeps not reaching the server, not that
   * capture itself should be refused.
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

  // Not wrapped in `KioskShell` — no mockup covers a login screen, and
  // `identity` (needed for the shell's operator badge) doesn't exist yet.
  if (!identity) {
    return (
      <LoginScreen
        authClient={authClient}
        onLoggedIn={(id) => setIdentity(id)}
        deviceLabel={window.location.hostname || 'Máy này'}
      />
    );
  }

  /**
   * `KioskShell` footer's camera chips, built from the raw role→deviceId
   * mapping `refreshDeviceState` stores. `ready` reflects whether that
   * role's assigned deviceId is CURRENTLY connected (`connectedDeviceIds`,
   * live `enumerateDevices()`), not just that it was configured at some
   * point — a role with a stale/unplugged deviceId still shows the chip
   * (so the operator can see it's misconfigured) but red/not-ready instead
   * of a misleading green. Shared by every shell instance below so the
   * footer stays identical across Standby/DeviceInit/capture.
   */
  const cameraFooterStatus: KioskCameraStatus[] = CAMERA_ROLE_ORDER.filter((role) => !!cameraRoleMapping[role]).map(
    (role) => ({
      id: role,
      label: CAMERA_ROLE_LABELS_VI[role],
      ready: connectedDeviceIds.has(cameraRoleMapping[role]),
    })
  );

  if (started && campaign) {
    return (
      <KioskShell
        systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên"
        operatorName={identity.displayName}
        cameras={cameraFooterStatus}
        onBack={() => {
          // Leaves any in-progress capture session behind — confirm first
          // so a misclick mid-session doesn't silently discard it.
          if (!window.confirm('Quay lại màn chọn đợt chụp? Phiên chụp đang dở sẽ không được lưu.')) return;
          setStarted(false);
          setCampaign(null);
          setCampaignConfig(null);
        }}
        onOpenSettings={() => {
          (window as any).faceAPI?.openCameraSetup?.();
        }}
      >
        {children(contentProps, campaignConfig, campaign.id)}
      </KioskShell>
    );
  }

  // Standby: identity is known but the first campaign-list fetch hasn't
  // resolved yet (`campaigns` still `null`) — see `loadCampaigns`'s own doc
  // comment for why this gate, not `DeviceInitScreen`, owns that fetch.
  if (!campaigns) {
    return (
      <KioskShell
        systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên"
        operatorName={identity.displayName}
        cameras={cameraFooterStatus}
        onOpenSettings={() => {
          (window as any).faceAPI?.openCameraSetup?.();
        }}
      >
        <StandbyScreen stationName={window.location.hostname || undefined} />
      </KioskShell>
    );
  }

  return (
    <KioskShell
      systemTitle="Hệ thống chụp ảnh & sinh trắc thẻ sinh viên"
      operatorName={identity.displayName}
      cameras={cameraFooterStatus}
      onOpenSettings={() => {
        (window as any).faceAPI?.openCameraSetup?.();
      }}
    >
      <DeviceInitScreen
        identity={identity}
        authClient={authClient}
        isAdmin={isAdmin}
        previewStreams={previewStreams}
        cameraStatuses={cameraFooterStatus}
        campaigns={campaigns}
        campaignsError={campaignsError}
        onReloadCampaigns={() => void loadCampaigns()}
        selectedCampaign={selectedCampaign}
        onSelectCampaign={setSelectedCampaign}
        mappedCameraCount={mappedCameraCount}
        sequencing={sequencing}
        captureMode={getSettings().captureMode ?? 'MANUAL'}
        onStartCapture={(c) => void handleStartCapture(c)}
        starting={starting}
        onOpenDeviceSettings={() => {
          (window as any).faceAPI?.openCameraSetup?.();
        }}
        onLogout={() => {
          authClient.logout();
          setIdentity(null);
          // `campaigns`/`selectedCampaign`/etc. live in this persistently-
          // mounted gate now (lifted here so it can distinguish Standby from
          // DeviceInitScreen — see `loadCampaigns`'s doc comment), unlike
          // before when they were local to `CampaignPickerScreen` and simply
          // vanished on unmount. Without resetting them here, a re-login as
          // a different operator would briefly render the PREVIOUS user's
          // campaign list (StandbyScreen would also be skipped, since
          // `campaigns` wouldn't be `null`) until the identity-keyed refetch
          // below catches up.
          setCampaigns(null);
          setCampaignsError(null);
          setSelectedCampaign(null);
          setIsAdmin(undefined);
        }}
      />
    </KioskShell>
  );
}
