import React, { useState } from "react";
import {
  CameraDevice,
  CaptureSensitivity,
  CaptureTriggerMode,
  FaceState,
  GestureState,
  GestureType,
  GuidanceState,
} from "@face/core";
import { StepItem } from "../workflow/StepProgress.js";
import { RectBounds } from "../face/FlyingThumbnail.js";
import { getSettings, updateSettings } from "../../lib/settingsStore.js";
import { cn } from "../../lib/utils.js";
import { LiquidGlassCard } from "../theme/LiquidGlassCard.js";
import { DesktopCaptureView } from "./views/DesktopCaptureView.js";
import { MobileCaptureView } from "./views/MobileCaptureView.js";
import { SharedCaptureViewProps } from "./views/types.js";
import type { CameraScale } from "./views/types.js";

export type { CameraScale };

export interface GuidedCaptureScreenProps {
  stream: MediaStream | null;
  faceState?: FaceState | null;
  guidance: GuidanceState;
  steps: StepItem[];
  devices: CameraDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  cameraFps?: number;
  cvFps?: number;
  stabilityProgress?: number;
  countdownValue?: number;
  showDebugPanel?: boolean;
  mode?: "simulation" | "live";
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  modeButton?: React.ReactNode;
  onCancel?: () => void;
  onStartLive?: () => void;
  isWorkflowStarted?: boolean;
  onStartWorkflow?: () => void;
  onOpenReview?: () => void;
  hasCompletedSession?: boolean;
  showScreenDebugStats?: boolean;
  onToggleShowScreenDebugStats?: (show: boolean) => void;
  className?: string;
  // Capture trigger & sensitivity
  gestureState?: GestureState | null;
  gestureProgress?: number;
  onShutterCapture?: () => void;
  sensitivity?: CaptureSensitivity;
  onSensitivityChange?: (sensitivity: CaptureSensitivity) => void;
  onCaptureModeChange?: (mode: CaptureTriggerMode) => void;
  onAutoHoldMsChange?: (ms: number) => void;
  latestCapturedImage?: { stepId: string; imagePath: string } | null;
}

export const GuidedCaptureScreen: React.FC<GuidedCaptureScreenProps> = (
  props,
) => {
  const {
    stream,
    faceState,
    guidance,
    steps,
    devices,
    selectedDeviceId,
    onSelectDevice,
    cameraFps = 30,
    cvFps = 0,
    stabilityProgress = 0,
    countdownValue = 0,
    showDebugPanel = true,
    mode = "simulation",
    theme = "dark",
    onToggleTheme,
    modeButton,
    onCancel,
    onStartLive,
    isWorkflowStarted = false,
    onStartWorkflow,
    onOpenReview,
    hasCompletedSession,
    showScreenDebugStats = true,
    onToggleShowScreenDebugStats,
    className,
    gestureState = null,
    gestureProgress = 0,
    onShutterCapture,
    sensitivity: externalSensitivity,
    onSensitivityChange,
    onCaptureModeChange: externalOnCaptureModeChange,
    onAutoHoldMsChange: externalOnAutoHoldMsChange,
    latestCapturedImage,
  } = props;

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [flashTrigger, setFlashTrigger] = useState(false);
  const [freezeSnapshot, setFreezeSnapshot] = useState<string | null>(null);
  const [flyingState, setFlyingState] = useState<{
    imageSrc: string | null;
    startRect: RectBounds | null;
    targetRect: RectBounds | null;
  }>({ imageSrc: null, startRect: null, targetRect: null });

  const lastHandledKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!latestCapturedImage || !latestCapturedImage.imagePath) return;

    const key = `${latestCapturedImage.stepId}_${latestCapturedImage.imagePath.length}_${latestCapturedImage.imagePath.slice(-20)}`;
    if (lastHandledKeyRef.current === key) return;
    lastHandledKeyRef.current = key;

    setFlashTrigger(true);
    setFreezeSnapshot(latestCapturedImage.imagePath);

    const freezeTimer = setTimeout(() => {
      setFreezeSnapshot(null);
    }, 450);

    const activeStepEl = document.querySelector(
      `[data-step-id="${latestCapturedImage.stepId}"]`,
    );
    if (activeStepEl && viewportRef.current) {
      const targetRect = activeStepEl.getBoundingClientRect();
      const viewportRect = viewportRef.current.getBoundingClientRect();

      const startRect: RectBounds = {
        x: viewportRect.left,
        y: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      };

      setFlyingState({
        imageSrc: latestCapturedImage.imagePath,
        startRect,
        targetRect: {
          x: targetRect.left,
          y: targetRect.top,
          width: targetRect.width,
          height: targetRect.height,
        },
      });
    }

    return () => clearTimeout(freezeTimer);
  }, [latestCapturedImage]);

  const checkIsMobileOrTablet = (): boolean => {
    if (typeof window === "undefined") return false;
    const isMobileUA =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const isNarrowWidth = window.innerWidth < 768; // Under 768px (Mobile & Portrait Tablet)
    return isNarrowWidth || isMobileUA;
  };

  const [isMobile, setIsMobile] = useState<boolean>(checkIsMobileOrTablet);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(checkIsMobileOrTablet());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const initialSettings = getSettings();

  const [cameraScale, setCameraScale] = useState<CameraScale>(
    initialSettings.cameraScale || "standard",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [overlayVisible, setOverlayVisible] = useState(
    initialSettings.overlayVisible ?? true,
  );
  const [overlayOpacity, setOverlayOpacity] = useState(
    initialSettings.overlayOpacity ?? 1.0,
  );
  const [showLandmarks, setShowLandmarks] = useState(
    initialSettings.showLandmarks ?? false,
  );
  const [landmarkSize, setLandmarkSize] = useState(
    initialSettings.landmarkSize ?? 1.5,
  );

  const [captureMode, setCaptureMode] = useState<CaptureTriggerMode>(
    initialSettings.captureMode || "AUTO",
  );
  const [autoHoldMs, setAutoHoldMs] = useState(
    initialSettings.autoHoldMs || 2000,
  );
  const [allowedGestures, setAllowedGestures] = useState<GestureType[]>(
    initialSettings.allowedGestures || ["VICTORY", "THUMBS_UP", "OPEN_PALM"],
  );
  const [internalSensitivity, setInternalSensitivity] =
    useState<CaptureSensitivity>(initialSettings.sensitivity || "MEDIUM");

  const activeSensitivity = externalSensitivity ?? internalSensitivity;

  const handleSensitivityChange = (sens: CaptureSensitivity) => {
    setInternalSensitivity(sens);
    updateSettings({ sensitivity: sens });
    if (onSensitivityChange) onSensitivityChange(sens);
  };

  const handleCaptureModeChange = (newMode: CaptureTriggerMode) => {
    setCaptureMode(newMode);
    updateSettings({ captureMode: newMode });
    if (externalOnCaptureModeChange) externalOnCaptureModeChange(newMode);
  };

  const handleAutoHoldMsChange = (ms: number) => {
    setAutoHoldMs(ms);
    updateSettings({ autoHoldMs: ms });
    if (externalOnAutoHoldMsChange) externalOnAutoHoldMsChange(ms);
  };

  const handleAllowedGesturesChange = (gestures: GestureType[]) => {
    setAllowedGestures(gestures);
    updateSettings({ allowedGestures: gestures });
  };

  const handleToggleOverlayVisible = () => {
    const next = !overlayVisible;
    setOverlayVisible(next);
    updateSettings({ overlayVisible: next });
  };

  const handleOpacityChange = (val: number) => {
    setOverlayOpacity(val);
    updateSettings({ overlayOpacity: val });
  };

  const handleToggleLandmarks = () => {
    const next = !showLandmarks;
    setShowLandmarks(next);
    updateSettings({ showLandmarks: next });
  };

  const handleLandmarkSizeChange = (val: number) => {
    setLandmarkSize(val);
    updateSettings({ landmarkSize: val });
  };

  const decreaseScale = () => {
    let next: CameraScale = cameraScale;
    if (cameraScale === "large") next = "standard";
    else if (cameraScale === "standard") next = "compact";
    setCameraScale(next);
    updateSettings({ cameraScale: next });
  };

  const increaseScale = () => {
    let next: CameraScale = cameraScale;
    if (cameraScale === "compact") next = "standard";
    else if (cameraScale === "standard") next = "large";
    setCameraScale(next);
    updateSettings({ cameraScale: next });
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const cameraWidthClass =
    cameraScale === "compact"
      ? "max-w-xl"
      : cameraScale === "large"
        ? "max-w-4xl"
        : "max-w-2xl";

  const renderTopLeftDebugOverlay = () => {
    const presenceText =
      faceState?.presence === "SINGLE_FACE"
        ? "Single Face"
        : faceState?.presence === "MULTIPLE_FACES"
          ? `Cảnh báo: ${faceState.faceCount} mặt!`
          : "Chưa phát hiện mặt";

    return (
      <div className="absolute top-2.5 left-2.5 z-40 flex flex-col items-start gap-1 pointer-events-none font-mono text-[10px]">
        <LiquidGlassCard
          theme={theme}
          variant="pill"
          className={cn(
            "px-2.5 py-0.5 font-bold transition-all duration-300",
            theme === "dark" ? "text-emerald-400" : "text-emerald-600 font-extrabold",
          )}
        >
          FPS:{cameraFps}/{cvFps}
        </LiquidGlassCard>

        <LiquidGlassCard
          theme={theme}
          variant="pill"
          className={cn(
            "px-2.5 py-0.5 font-bold transition-all duration-300",
            faceState?.presence === "SINGLE_FACE"
              ? "bg-emerald-500/80 text-white border-emerald-400"
              : faceState?.presence === "MULTIPLE_FACES"
                ? "bg-amber-500/90 text-slate-950 font-black border-amber-300 animate-pulse"
                : "",
          )}
        >
          {presenceText}
        </LiquidGlassCard>
      </div>
    );
  };

  const renderFaceDiagnostics = () => {
    if (!faceState || !faceState.quality) return null;
    const { quality, presence } = faceState;

    if (presence === "MULTIPLE_FACES") {
      return (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="px-4 py-2 rounded-full bg-amber-500/90 backdrop-blur-2xl text-slate-950 font-bold text-xs border border-amber-300 shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.6),0_12px_32px_rgba(245,158,11,0.4)] flex items-center gap-1.5 animate-bounce">
            <span>⚠️</span>
            <span>Phát hiện nhiều khuôn mặt! Chỉ đứng 1 người</span>
          </div>
        </div>
      );
    }

    if (presence === "NO_FACE" || !quality.accepted) {
      const reasonMap: Record<string, { icon: string; text: string }> = {
        NO_FACE: { icon: "👤", text: "Vui lòng di chuyển vào khung hình" },
        TOO_FAR: { icon: "🔍", text: "Lại gần camera hơn" },
        TOO_CLOSE: { icon: "↔️", text: "Lùi xa camera hơn một chút" },
        NOT_CENTERED: {
          icon: "🎯",
          text: "Di chuyển khuôn mặt vào giữa khung",
        },
        TOO_DARK: { icon: "💡", text: "Môi trường quá tối" },
        TOO_BRIGHT: { icon: "☀️", text: "Môi trường quá chói sáng" },
        BLURRY: { icon: "👓", text: "Khuôn mặt bị mờ, giữ yên camera" },
        POOR_ANGLE: { icon: "📐", text: "Xoay mặt nhìn thẳng vào camera" },
      };

      const primaryReason = quality.reasons[0] || "NO_FACE";
      const info = reasonMap[primaryReason] || {
        icon: "⚠️",
        text: "Điều chỉnh vị trí khuôn mặt",
      };

      return (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <LiquidGlassCard
            theme={theme}
            variant="pill"
            className="px-4 py-2 flex items-center gap-2"
          >
            <span className="text-sm leading-none">{info.icon}</span>
            <span className="tracking-wide font-medium text-xs">{info.text}</span>
          </LiquidGlassCard>
        </div>
      );
    }

    return null;
  };

  const sharedProps: SharedCaptureViewProps = {
    stream,
    faceState,
    guidance,
    steps,
    devices,
    selectedDeviceId,
    onSelectDevice,
    cameraFps,
    cvFps,
    stabilityProgress,
    countdownValue,
    showDebugPanel,
    mode,
    theme,
    onToggleTheme,
    modeButton,
    onCancel,
    onStartLive,
    isWorkflowStarted,
    onStartWorkflow,
    onOpenReview,
    hasCompletedSession,
    showScreenDebugStats,
    onToggleShowScreenDebugStats,
    className,
    gestureState,
    gestureProgress,
    onShutterCapture,
    cameraScale,
    decreaseScale,
    increaseScale,
    isFullscreen,
    toggleFullscreen,
    cameraWidthClass,
    viewportRef,
    overlayVisible,
    overlayOpacity,
    showLandmarks,
    landmarkSize,
    flashTrigger,
    setFlashTrigger,
    freezeSnapshot,
    flyingState,
    setFlyingState,
    renderTopLeftDebugOverlay,
    renderFaceDiagnostics,
    captureMode,
    autoHoldMs,
    allowedGestures,
    handleToggleOverlayVisible,
    handleOpacityChange,
    handleToggleLandmarks,
    handleLandmarkSizeChange,
    handleCaptureModeChange,
    handleAutoHoldMsChange,
    handleAllowedGesturesChange,
    activeSensitivity,
    handleSensitivityChange,
  };

  if (isMobile) {
    return <MobileCaptureView {...sharedProps} />;
  }

  return <DesktopCaptureView {...sharedProps} />;
};
