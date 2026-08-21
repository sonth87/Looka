import { useEffect, Component, ReactNode } from "react";
import { DeviceLayout, AppConfig } from "@sonth87/device-layout";
import { FaceCaptureApp, HttpCaptureSink, LookaIcon } from "@face/ui";

/**
 * Captures go to our own backend, which holds the file-service key.
 *
 * That key covers the whole namespace, so a page holding it could read and
 * write every file this service owns. The browser therefore talks only to this
 * API and never to the file-service directly.
 */
const captureSink = new HttpCaptureSink(
  // Resolved at run time, not baked in at build time: the same bundle is served
  // from a developer machine and from a kiosk on the network, and those do not
  // share an API address. A deployment overrides it by setting the global before
  // the bundle loads.
  (window as { LOOKA_API_BASE_URL?: string }).LOOKA_API_BASE_URL ?? "http://localhost:3100",
  // Same run-time-override pattern - the backend's ApiKeyMiddleware rejects
  // every session/photo request without this.
  (window as { LOOKA_API_KEY?: string }).LOOKA_API_KEY
);

const CaptureScreen = () => <FaceCaptureApp sink={captureSink} />;

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error(
      "🔴 [AppErrorBoundary] Caught uncaught React rendering error:",
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-950 text-red-200 font-mono h-screen w-screen overflow-auto">
          <h1 className="text-xl font-bold mb-2">
            🔴 [AppErrorBoundary] React Uncaught Crash
          </h1>
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
    id: "looka-face-capture",
    name: "Looka",
    icon: LookaIcon,
    iconColor: ["#ffffff", "#e0f2fe"],
    render: CaptureScreen,
    rawIcon: true,
    defaultSize: { width: 1150, height: 780 },
    minSize: { width: 640, height: 480 },
    defaultMaximized: true,
    category: "utilities",
  },
];

export default function App() {
  useEffect(() => {
    // Sanitize any corrupt ?w=undefined search parameters from browser history
    if (
      typeof window !== "undefined" &&
      window.location.search.includes("undefined")
    ) {
      console.warn(
        "⚠️ [App] Detected corrupt ?w=undefined URL parameter, cleaning up URL...",
      );
      window.history.replaceState(null, "", window.location.pathname);
    }

    console.log("🚀 [App] Shell mounted. appsConfig:", appsConfig);

    const handleError = (event: ErrorEvent) => {
      console.error(
        "💥 [Global Window Error]:",
        event.error || event.message,
        event.filename,
        event.lineno,
      );
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("💥 [Global Unhandled Rejection]:", event.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <AppErrorBoundary>
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
          colorScheme="light"
          osTheme="macos"
          fallbackMenuBarAppId="looka-face-capture"
        />
      </div>
    </AppErrorBoundary>
  );
}
