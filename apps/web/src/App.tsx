import { useEffect, Component, ReactNode } from 'react';
import { DeviceLayout, AppConfig } from '@sonth87/device-layout';
import { FaceCaptureApp } from './components/FaceCaptureApp';

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('🔴 [AppErrorBoundary] Caught uncaught React rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-950 text-red-200 font-mono h-screen w-screen overflow-auto">
          <h1 className="text-xl font-bold mb-2">🔴 [AppErrorBoundary] React Uncaught Crash</h1>
          <pre className="bg-black/50 p-4 rounded text-sm text-red-300 whitespace-pre-wrap">
            {this.state.error?.stack || this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  useEffect(() => {
    // Sanitize any corrupt ?w=undefined search parameters from browser history
    if (typeof window !== 'undefined' && window.location.search.includes('undefined')) {
      console.warn('⚠️ [App] Detected corrupt ?w=undefined URL parameter, cleaning up URL...');
      window.history.replaceState(null, '', window.location.pathname);
    }

    console.log('🚀 [App] Shell mounted. appsConfig:', appsConfig);

    const handleError = (event: ErrorEvent) => {
      console.error('💥 [Global Window Error]:', event.error || event.message, event.filename, event.lineno);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('💥 [Global Unhandled Rejection]:', event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  const DeviceLayoutComponent = DeviceLayout as any;

  return (
    <AppErrorBoundary>
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
    </AppErrorBoundary>
  );
}
