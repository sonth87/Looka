import { DeviceLayout, AppConfig, AppContentProps } from '@sonth87/device-layout';
// import { UserCheck } from 'lucide-react'; // only used by the commented-out attendance app entry below
import { ElectronCaptureSink, FaceCaptureApp, /* KioskAttendanceApp, */ LookaIcon } from '@face/ui';
import { CampaignGate, authClient } from './CampaignGate';

const electronCaptureSink = new ElectronCaptureSink();

/**
 * Supplies the desktop-specific CaptureSink that FaceCaptureApp needs to
 * actually persist a capture. device-layout's `render` slot only forwards
 * AppContentProps (window id, focus state, etc.) — it has no notion of a
 * sink — so the sink is injected here via closure instead of being passed
 * down from the shell. See FaceCaptureAppProps.sink's own doc comment:
 * "the desktop kiosk hands photos to its main process."
 *
 * Without this wrapper, `FaceCaptureApp` renders with `sink` undefined and
 * every capture on this app silently fails to save (storePhoto's own
 * `if (!sink)` guard) — the pipeline behind `window.faceAPI.queueCapture`
 * exists and is idle, waiting for exactly this call.
 *
 * Wrapped in `CampaignGate` (§3.8.1: Đăng nhập → Chọn campaign → Trang
 * campaign → chụp) — `FaceCaptureApp` itself, and everything it does, is
 * completely unchanged; the gate only decides WHEN this component mounts,
 * and now also WHICH capture config it mounts with: `CampaignGate` fetches
 * the selected campaign's real config (steps, "quay video") once the
 * operator presses "Thực hiện chụp ảnh" and hands it through as the second
 * `children` argument — forwarded here as `campaignConfig` so
 * `FaceCaptureApp` uses the campaign + login access model (no device-secret
 * check at all) instead of its legacy `window.faceAPI.getDeviceAccessStatus()`
 * fallback. See `FaceCaptureApp`'s `resolveActiveWorkflow` for what each
 * path does.
 *
 * `operatorUserId` (2026-09-09, "thống kê phần giảng viên chụp" — see
 * `FaceCaptureAppProps.operatorUserId`'s own doc comment): read straight
 * from `authClient` rather than threaded through `CampaignGate`'s own
 * `children` callback, since — unlike `campaignConfig` — it doesn't change
 * per campaign selection; it's set once at login and stable for the whole
 * kiosk session.
 *
 * `campaignId`/`authClient` (2026-09-09, CCCD-scan capture-identification
 * feature): `campaignId` comes through `CampaignGate`'s `children` callback
 * (see that prop's own doc comment there); `authClient` is the same
 * already-imported SSO singleton `operatorUserId` above reads from — passed
 * straight through so `FaceCaptureApp.tsx`'s `handleCccdScan` can call
 * `GET /v1/campaigns/:id/roster/lookup` with the operator's own SSO headers
 * without this package needing its own copy of `SsoAuthClient`.
 */
function FaceCaptureAppWithFsSink(props: AppContentProps) {
  return (
    <CampaignGate contentProps={props}>
      {(p, campaignConfig, campaignId) => (
        <FaceCaptureApp
          {...p}
          sink={electronCaptureSink}
          campaignConfig={campaignConfig}
          campaignId={campaignId}
          authClient={authClient}
          operatorUserId={authClient.getOperatorUserId()}
        />
      )}
    </CampaignGate>
  );
}

const appsConfig: AppConfig[] = [
  {
    id: 'looka-face-capture',
    name: 'Looka',
    icon: LookaIcon,
    iconColor: ['#ffffff', '#e0f2fe'],
    render: FaceCaptureAppWithFsSink,
    defaultSize: { width: 1150, height: 780 },
    minSize: { width: 640, height: 480 },
    defaultMaximized: true,
    category: 'utilities',
  },
  // Attendance (Pillar B demo) deliberately deferred — parked, not deleted:
  // main/preload/IPC wiring (attendance.ts, index.ts's attendance:* handlers,
  // preload's attendanceEnroll/ProcessFrame/etc.) and the renderer
  // KioskAttendanceApp component all still exist and still build/test clean.
  // Uncomment this entry (and the two imports above) to bring the "Chấm
  // công (Demo)" icon back.
  // {
  //   id: 'looka-attendance-demo',
  //   name: 'Chấm công (Demo)',
  //   icon: UserCheck,
  //   iconColor: ['#10b981', '#065f46'],
  //   render: () => <KioskAttendanceApp />,
  //   defaultSize: { width: 900, height: 700 },
  //   minSize: { width: 480, height: 480 },
  //   defaultMaximized: true,
  //   category: 'utilities',
  // },
];

export default function App() {
  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-950">
      <DeviceLayout
        assetBaseUrl="https://device-layout.vercel.app"
        apps={appsConfig}
        isSimpleMode={{
          wallpaper: true,
          contextMenu: true,
          wallpaperPicker: true,
          iconGrid: true,
          dock: false,
          menuBar: { clock: true, spotlight: false, controlCenter: false },
        }}
        colorScheme="dark"
        osTheme="macos"
        fallbackMenuBarAppId="looka-face-capture"
      />
    </div>
  );
}
