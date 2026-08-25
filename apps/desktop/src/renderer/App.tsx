import { DeviceLayout, AppConfig, AppContentProps } from '@sonth87/device-layout';
import { ElectronCaptureSink, FaceCaptureApp, LookaIcon } from '@face/ui';

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
 */
function FaceCaptureAppWithFsSink(props: AppContentProps) {
  return <FaceCaptureApp {...props} sink={electronCaptureSink} />;
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
