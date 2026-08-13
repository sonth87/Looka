import { DeviceLayout, AppConfig } from '@sonth87/device-layout';
import { FaceCaptureApp } from './components/FaceCaptureApp';

const appsConfig: AppConfig[] = [
  {
    id: 'looka-face-capture',
    name: 'Looka',
    icon: 'lucide:Camera',
    iconColor: ['#2563eb', '#1d4ed8'],
    render: FaceCaptureApp,
    defaultSize: { width: 1150, height: 780 },
    minSize: { width: 640, height: 480 },
    category: 'utilities',
  },
];

export default function App() {
  const DeviceLayoutComponent = DeviceLayout as any;

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-950">
      <DeviceLayoutComponent
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
