import React, { useState } from "react";
import { Minus, Plus, Maximize, Minimize, Play, Camera } from "lucide-react";
import {
  CameraDevice,
  CaptureSensitivity,
  CaptureTriggerMode,
  FaceState,
  GestureState,
  GestureType,
  GuidanceState,
} from "@face/core";
import { CameraPreview } from "../camera/CameraPreview.js";
import { CameraSelector } from "../camera/CameraSelector.js";
import { FaceOverlay } from "../face/FaceOverlay.js";
import { GestureOverlay } from "../face/GestureOverlay.js";
import { ShutterButton } from "../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../face/ShutterFlashOverlay.js";
import { FlyingThumbnail, RectBounds } from "../face/FlyingThumbnail.js";
import { StepProgress, StepItem } from "../workflow/StepProgress.js";
import { GuidanceMessage } from "../workflow/GuidanceMessage.js";
import { StabilityProgress } from "../workflow/StabilityProgress.js";
import { CountdownTimer } from "../workflow/CountdownTimer.js";
import { DebugPanel } from "../debug/DebugPanel.js";
import { OverlayConfigPanel } from "../debug/OverlayConfigPanel.js";
import { ThemeToggle } from "../theme/ThemeToggle.js";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../ui/tooltip.js";
import { cn } from "../../lib/utils.js";
import { getSettings, updateSettings } from "../../lib/settingsStore.js";

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

export type CameraScale = "compact" | "standard" | "large";

export const GuidedCaptureScreen: React.FC<GuidedCaptureScreenProps> = ({
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
  className,
  gestureState = null,
  gestureProgress = 0,
  onShutterCapture,
  sensitivity: externalSensitivity,
  onSensitivityChange,
  onCaptureModeChange: externalOnCaptureModeChange,
  onAutoHoldMsChange: externalOnAutoHoldMsChange,
  latestCapturedImage,
}) => {
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

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initialSettings = getSettings();

  const [cameraScale, setCameraScale] = useState<CameraScale>(
    initialSettings.cameraScale || "standard",
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    initialSettings.isFullscreen ?? false,
  );
  const [overlayVisible, setOverlayVisible] = useState<boolean>(
    initialSettings.overlayVisible ?? true,
  );
  const [overlayOpacity, setOverlayOpacity] = useState<number>(
    initialSettings.overlayOpacity ?? 1.0,
  );
  const [showLandmarks, setShowLandmarks] = useState<boolean>(
    initialSettings.showLandmarks ?? false,
  );
  const [captureMode, setCaptureMode] = useState<CaptureTriggerMode>(
    initialSettings.captureMode || "AUTO",
  );
  const [autoHoldMs, setAutoHoldMs] = useState<number>(
    initialSettings.autoHoldMs || 2000,
  );
  const [allowedGestures, setAllowedGestures] = useState<GestureType[]>(
    initialSettings.allowedGestures || ["VICTORY", "THUMBS_UP", "OPEN_PALM"],
  );
  const [sensitivityState, setSensitivityState] = useState<CaptureSensitivity>(
    initialSettings.sensitivity || "MEDIUM",
  );
  const [landmarkSize, setLandmarkSize] = useState<number>(
    initialSettings.landmarkSize || 1.5,
  );

  const activeSensitivity = externalSensitivity || sensitivityState;

  const handleToggleOverlayVisible = (val: boolean) => {
    setOverlayVisible(val);
    updateSettings({ overlayVisible: val });
  };

  const handleOpacityChange = (val: number) => {
    setOverlayOpacity(val);
    updateSettings({ overlayOpacity: val });
  };

  const handleToggleLandmarks = (val: boolean) => {
    setShowLandmarks(val);
    updateSettings({ showLandmarks: val });
  };

  const handleLandmarkSizeChange = (val: number) => {
    setLandmarkSize(val);
    updateSettings({ landmarkSize: val });
  };

  const handleCaptureModeChange = (val: CaptureTriggerMode) => {
    setCaptureMode(val);
    updateSettings({ captureMode: val });
    if (externalOnCaptureModeChange) externalOnCaptureModeChange(val);
  };

  const handleAutoHoldMsChange = (val: number) => {
    setAutoHoldMs(val);
    updateSettings({ autoHoldMs: val });
    if (externalOnAutoHoldMsChange) externalOnAutoHoldMsChange(val);
  };

  const handleAllowedGesturesChange = (val: GestureType[]) => {
    setAllowedGestures(val);
    updateSettings({ allowedGestures: val });
  };

  const handleSensitivityChange = (val: CaptureSensitivity) => {
    setSensitivityState(val);
    updateSettings({ sensitivity: val });
    if (onSensitivityChange) onSensitivityChange(val);
  };

  const decreaseScale = () => {
    setCameraScale((prev) => {
      const next = prev === "large" ? "standard" : "compact";
      updateSettings({ cameraScale: next });
      return next;
    });
  };

  const increaseScale = () => {
    setCameraScale((prev) => {
      const next = prev === "compact" ? "standard" : "large";
      updateSettings({ cameraScale: next });
      return next;
    });
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => {
      const next = !prev;
      updateSettings({ isFullscreen: next });
      return next;
    });
  };

  const cameraWidthClass =
    cameraScale === "compact"
      ? "max-w-md"
      : cameraScale === "large"
        ? "max-w-4xl"
        : "max-w-2xl";

  return (
    <div
      className={cn(
        "relative min-h-screen flex flex-col items-center justify-between p-2 sm:p-5 overflow-x-hidden select-none transition-colors duration-300",
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900",
        className,
      )}
    >
      {/* ── Fixed Top-Right Theme Toggle & Camera Selector ── */}
      {!isFullscreen && (
        <div className="fixed top-2 sm:top-3.5 right-2 sm:right-4 z-[60] flex items-center gap-2">
          {devices && devices.length > 1 && (
            <CameraSelector
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onSelectDevice={onSelectDevice}
            />
          )}
          {onToggleTheme && <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />}
        </div>
      )}

      {/* ── Top Header (Hidden in Fullscreen) ── */}
      {!isFullscreen && (
        <header className="w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 pt-1 pb-1">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500 font-black text-xs sm:text-sm shrink-0 shadow-md">
              FP
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-bold tracking-tight leading-tight">
                Face Capture
              </h1>
              <p
                className={cn(
                  "text-[10px] sm:text-[11px] leading-tight hidden sm:block",
                  theme === "dark" ? "text-slate-400" : "text-slate-500",
                )}
              >
                Hệ thống hướng dẫn chụp ảnh tự động
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 pr-9 sm:pr-12">
            {modeButton}
          </div>
        </header>
      )}

      {/* ── Steps Line (Desktop only, hidden on mobile & fullscreen) ── */}
      {!isFullscreen && !isMobile && (
        <div className="w-full max-w-lg my-1 px-2 sm:px-0">
          <StepProgress
            steps={steps}
            currentStepIndex={guidance.currentStepIndex}
            theme={theme}
          />
        </div>
      )}

      {/* ── Main Content: Camera Display ── */}
      <main
        className={cn(
          "w-full flex-1 flex flex-col items-center justify-center z-10",
          isFullscreen
            ? "fixed inset-0 p-0 m-0 z-40 bg-black"
            : isMobile
            ? "my-1 px-1 h-[68vh] max-h-[72vh] flex-1"
            : "my-1 sm:my-2 px-1 sm:px-0",
        )}
      >
        <div
          ref={viewportRef}
          className={cn(
            "relative transition-all duration-300 flex items-center justify-center",
            isFullscreen
              ? "w-full h-full rounded-none"
              : isMobile
              ? "w-full h-full max-w-sm mx-auto"
              : cn("w-full", cameraWidthClass),
          )}
        >
          {/* ── 3 Control Buttons: "-" (Decrease), "+" (Increase), Fullscreen (Hidden on Mobile) ── */}
          <TooltipProvider>
            <div className="hidden sm:flex absolute top-2.5 sm:top-3 right-2.5 sm:right-3 z-50 items-center gap-0.5 sm:gap-1 bg-slate-950/75 backdrop-blur-md p-0.5 sm:p-1 rounded-xl border border-slate-800/80 shadow-2xl">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={decreaseScale}
                    disabled={cameraScale === "compact" || isFullscreen}
                    className={cn(
                      "p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                      theme === "dark"
                        ? "text-slate-300 hover:text-white hover:bg-slate-800"
                        : "text-slate-300 hover:text-white hover:bg-slate-800",
                    )}
                  >
                    <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  Giảm kích thước camera (-)
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={increaseScale}
                    disabled={cameraScale === "large" || isFullscreen}
                    className={cn(
                      "p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                      theme === "dark"
                        ? "text-slate-300 hover:text-white hover:bg-slate-800"
                        : "text-slate-300 hover:text-white hover:bg-slate-800",
                    )}
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  Tăng kích thước camera (+)
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleFullscreen}
                    className={cn(
                      "p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer",
                      isFullscreen
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-slate-300 hover:text-white hover:bg-slate-800",
                    )}
                  >
                    {isFullscreen ? (
                      <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    ) : (
                      <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  {isFullscreen
                    ? "Thoát Toàn màn hình"
                    : "Toàn màn hình (Fullscreen)"}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Camera Preview */}
          <CameraPreview
            stream={stream}
            aspectRatio={isFullscreen ? 'auto' : isMobile ? '3/4' : '16/9'}
            className={cn(
              'w-full overflow-hidden transition-all border-0 shadow-none bg-transparent',
              isFullscreen
                ? 'w-screen h-screen rounded-none bg-black'
                : isMobile
                ? 'w-full h-full rounded-3xl border border-slate-800/50 shadow-2xl'
                : 'rounded-2xl sm:rounded-3xl'
            )}
          >
            {((mode === "live" && stream) || mode === "simulation") && (
              <FaceOverlay
                faceState={faceState}
                showLandmarks={showLandmarks}
                landmarkSize={landmarkSize}
                visible={overlayVisible}
                opacity={overlayOpacity}
                mirrored={true}
                variant="capture"
                stabilityProgress={stabilityProgress}
                autoHoldMs={autoHoldMs}
              />
            )}
            <CountdownTimer value={countdownValue} />
            {freezeSnapshot && (
              <img
                src={freezeSnapshot}
                alt="Captured Snapshot Freeze"
                className="absolute inset-0 w-full h-full object-cover z-25 pointer-events-none transition-opacity duration-150 animate-in fade-in"
              />
            )}
            <ShutterFlashOverlay
              trigger={flashTrigger}
              onFlashComplete={() => setFlashTrigger(false)}
            />
            <FlyingThumbnail
              imageSrc={flyingState.imageSrc}
              startRect={flyingState.startRect}
              targetRect={flyingState.targetRect}
              onAnimationEnd={() =>
                setFlyingState({
                  imageSrc: null,
                  startRect: null,
                  targetRect: null,
                })
              }
            />

            {/* No-stream / Start Camera UI */}
            {!stream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-transparent p-4 z-20">
                <div className={cn('w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg border backdrop-blur-md', theme === 'dark' ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-blue-50 border-blue-300 text-blue-600')}>
                  <Camera className="w-6 h-6 sm:w-7 sm:h-7 animate-pulse" />
                </div>
                <div className="text-center space-y-0.5 max-w-xs">
                  <h3 className={cn('text-xs sm:text-sm font-bold', theme === 'dark' ? 'text-slate-200' : 'text-slate-800')}>
                    Chế độ Live Camera
                  </h3>
                  <p className={cn('text-[11px] font-medium', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>
                    Bấm nút bên dưới để khởi động camera
                  </p>
                </div>
                {onStartLive && (
                  <button
                    onClick={onStartLive}
                    className="mt-1 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all duration-300 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Bắt đầu
                  </button>
                )}
              </div>
            )}

            {/* Gesture Overlay (MANUAL mode) */}
            {mode === "live" && captureMode === "MANUAL" && (
              <GestureOverlay
                gestureState={gestureState}
                gestureProgress={gestureProgress}
                faceReady={faceState?.detected ?? false}
              />
            )}

            {/* Shutter Button (OFF mode) */}
            {mode === "live" && captureMode === "OFF" && onShutterCapture && (
              <ShutterButton
                enabled={faceState?.detected ?? false}
                onCapture={onShutterCapture}
              />
            )}

            {/* Stability progress bar (AUTO mode) */}
            {stabilityProgress > 0 && captureMode === "AUTO" && (
              <div className="absolute bottom-16 sm:bottom-4 left-1/2 -translate-x-1/2 w-48 sm:w-56 z-20">
                <StabilityProgress
                  progress={stabilityProgress}
                  text="Giữ nguyên tư thế..."
                />
              </div>
            )}

            {/* StepProgress (Overlayed at Top inside Camera View on Mobile & Fullscreen) */}
            {(isFullscreen || isMobile) && (
              <div className="absolute top-3 inset-x-0 z-40 w-full max-w-md mx-auto px-3 pointer-events-auto">
                <StepProgress
                  steps={steps}
                  currentStepIndex={guidance.currentStepIndex}
                  theme="dark"
                />
              </div>
            )}

            {/* Mobile Overlayed Pre-Start & Guidance (Inside Camera View at Bottom) */}
            {isMobile && stream && (
              <div className="absolute bottom-4 inset-x-0 z-40 flex flex-col items-center gap-2 px-3 pointer-events-auto text-center">
                {!isWorkflowStarted && onStartWorkflow ? (
                  <>
                    <div className="px-3.5 py-1.5 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-700/70 shadow-lg text-slate-200 text-xs font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Camera đã bật. Nhấn Bắt đầu để chụp.
                    </div>
                    <button
                      onClick={onStartWorkflow}
                      className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all duration-300 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      Bắt đầu
                    </button>
                  </>
                ) : (
                  <>
                    <GuidanceMessage guidance={guidance} theme="dark" />
                    {onCancel && (
                      <button
                        onClick={onCancel}
                        className="text-[11px] text-slate-400 hover:text-slate-200 underline transition-colors cursor-pointer"
                      >
                        Hủy bỏ quy trình
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Fullscreen Desktop Guidance Overlay */}
            {isFullscreen && !isMobile && (
              <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-3 sm:px-4 pointer-events-auto">
                <GuidanceMessage guidance={guidance} theme="dark" />
                {onCancel && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={onCancel}
                      className="text-xs text-slate-400 hover:text-slate-200 underline transition-colors cursor-pointer"
                    >
                      Hủy bỏ quy trình
                    </button>
                  </div>
                )}
              </div>
            )}
          </CameraPreview>
        </div>
      </main>

      {/* ── Guidance Message & Start Button Panel (Desktop only, hidden on mobile & fullscreen) ── */}
      {!isFullscreen && !isMobile && (
        <footer className="w-full max-w-md z-10 mt-2 sm:mt-4 mb-2 pb-2 px-2 sm:px-0">
          {!isWorkflowStarted && stream && onStartWorkflow ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <GuidanceMessage
                guidance={{
                  status: 'READY',
                  primaryInstruction: 'Camera đã bật. Nhấn nút Bắt đầu để tiến hành chụp 5 bước.',
                  primaryReason: 'READY',
                  progress: 0,
                  hints: faceState?.detected
                    ? [{ code: 'READY', message: 'Khuôn mặt đã nằm trong vị trí camera' }]
                    : [{ code: 'NO_FACE', message: 'Vui lòng đứng trước camera' }],
                  currentStepIndex: 0,
                  totalSteps: steps.length,
                  stepId: steps[0]?.id || '',
                  stepType: 'FRONT',
                }}
                theme={theme}
              />
              <button
                onClick={onStartWorkflow}
                className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs tracking-wider uppercase shadow-xl shadow-blue-500/30 transition-all duration-300 active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                Bắt đầu chụp (5 bước)
              </button>
            </div>
          ) : (
            <>
              <GuidanceMessage guidance={guidance} theme={theme} />
              {onCancel && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={onCancel}
                    className={cn(
                      "text-xs underline transition-colors cursor-pointer",
                      theme === "dark"
                        ? "text-slate-500 hover:text-slate-300"
                        : "text-slate-400 hover:text-slate-700",
                    )}
                  >
                    Hủy bỏ quy trình
                  </button>
                </div>
              )}
            </>
          )}
        </footer>
      )}

      {/* ── Draggable CV Debug Panel & Overlay Config Panel ── */}
      {showDebugPanel && (
        <>
          <DebugPanel
            faceState={faceState}
            fps={cameraFps}
            cvFps={cvFps}
            theme={theme}
            isFullscreen={isFullscreen}
            defaultPosition={{ x: 30, y: 160 }}
          />

          {mode === "live" && (
            <OverlayConfigPanel
              visible={overlayVisible}
              onToggleVisible={handleToggleOverlayVisible}
              opacity={overlayOpacity}
              onOpacityChange={handleOpacityChange}
              showLandmarks={showLandmarks}
              onToggleLandmarks={handleToggleLandmarks}
              landmarkSize={landmarkSize}
              onLandmarkSizeChange={handleLandmarkSizeChange}
              captureMode={captureMode}
              onCaptureModeChange={handleCaptureModeChange}
              autoHoldMs={autoHoldMs}
              onAutoHoldMsChange={handleAutoHoldMsChange}
              allowedGestures={allowedGestures}
              onAllowedGesturesChange={handleAllowedGesturesChange}
              sensitivity={activeSensitivity}
              onSensitivityChange={handleSensitivityChange}
              theme={theme}
              isFullscreen={isFullscreen}
              defaultPosition={{ x: 30, y: 440 }}
            />
          )}
        </>
      )}
    </div>
  );
};
