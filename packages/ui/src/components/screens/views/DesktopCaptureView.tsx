import React, { useState } from "react";
import {
  Minus,
  Plus,
  Maximize,
  Minimize,
  Play,
  Camera,
  Images,
  Activity,
  CheckCircle2,
  XCircle,
  Sparkles,
  Sun,
  Moon,
  Gauge,
  Eye,
  EyeOff,
  CircleDot,
  Timer,
  Hand,
  Sliders,
  Compass,
  Crosshair,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { SharedCaptureViewProps } from "./types.js";
import { CameraPreview } from "../../camera/CameraPreview.js";
import { LookaIcon } from "../../theme/LookaIcon.js";
import { CameraSelector } from "../../camera/CameraSelector.js";
import { FaceOverlay } from "../../face/FaceOverlay.js";
import { GestureOverlay } from "../../face/GestureOverlay.js";
import { ShutterButton } from "../../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../../face/ShutterFlashOverlay.js";
import { FlyingThumbnail } from "../../face/FlyingThumbnail.js";
import { StepProgress } from "../../workflow/StepProgress.js";
import { StabilityProgress } from "../../workflow/StabilityProgress.js";
import { CountdownTimer } from "../../workflow/CountdownTimer.js";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../../ui/tooltip.js";
import { cn } from "../../../lib/utils.js";

export const DesktopCaptureView: React.FC<SharedCaptureViewProps> = (props) => {
  const {
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
    mode = "simulation",
    theme = "dark",
    onToggleTheme,
    onCancel,
    onStartLive,
    isCameraLoading = false,
    cameraError = null,
    isWorkflowStarted,
    onStartWorkflow,
    onOpenReview,
    hasCapturedImages,
    showScreenDebugStats,
    onToggleShowScreenDebugStats,
    className,
    gestureState = null,
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
  } = props;

  const [showTelemetryDrawer, setShowTelemetryDrawer] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"debug" | "overlay">(
    "debug",
  );

  return (
    <div
      className={cn(
        "relative w-full h-full min-h-full flex flex-col justify-between items-center transition-colors duration-300 select-none overflow-hidden",
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900",
        className,
      )}
    >
      {/* ── Top Header Bar ── */}
      {!isFullscreen && (
        <header
          className={cn(
            "w-full px-3 sm:px-5 py-2 flex items-center justify-between gap-3 shrink-0 border-b z-30 transition-colors duration-300",
            theme === "dark"
              ? "border-slate-800/80 bg-slate-950/90 text-slate-100 backdrop-blur-md"
              : "border-slate-200/90 bg-white/90 text-slate-900 backdrop-blur-md shadow-sm",
          )}
        >
          {/* Brand & System Status */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
                <LookaIcon className="w-full h-full" />
              </div>
              <div>
                <h1
                  className={cn(
                    "text-xs sm:text-sm font-bold tracking-tight flex items-center gap-1.5",
                    theme === "dark" ? "text-white" : "text-slate-900",
                  )}
                >
                  Looka
                  <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                    Biometric Capture
                  </span>
                </h1>
              </div>
            </div>

            {/* Status dot */}
            <div
              className={cn(
                "hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px]",
                theme === "dark"
                  ? "bg-slate-900 border-slate-800 text-slate-400"
                  : "bg-slate-100 border-slate-200 text-slate-600",
              )}
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  stream ? "bg-emerald-500 animate-pulse" : "bg-amber-500",
                )}
              />
              <span>{stream ? "Live Camera Ready" : "Standby"}</span>
            </div>
          </div>

          {/* Center: Inline Timeline StepProgress Pill (Collapses cleanly on narrow windows) */}
          <div className="hidden sm:flex items-center max-w-md w-full mx-2 shrink overflow-visible py-1">
            <StepProgress
              steps={steps}
              currentStepIndex={guidance.currentStepIndex}
              theme={theme}
            />
          </div>

          {/* Right Action Controls: Identical Button Sizing (w-8 h-8 rounded-xl) */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Camera Selector */}
            {devices && devices.length > 1 && (
              <CameraSelector
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={onSelectDevice}
              />
            )}

            {/* Theme Toggle Button (Identical w-8 h-8 size) */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 shadow-sm",
                  theme === "dark"
                    ? "bg-slate-900 border-slate-800 text-amber-400 hover:bg-slate-800"
                    : "bg-white border-slate-200 text-purple-600 hover:bg-slate-100 shadow-slate-200/50",
                )}
                title={
                  theme === "dark"
                    ? "Chuyển sang Giao diện Sáng"
                    : "Chuyển sang Giao diện Tối"
                }
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-purple-600" />
                )}
              </button>
            )}

            {/* AI Telemetry Toggle Button (Identical w-8 h-8 size) */}
            <button
              onClick={() => setShowTelemetryDrawer((prev) => !prev)}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 shadow-sm",
                showTelemetryDrawer
                  ? "bg-blue-600/20 border-blue-500/50 text-blue-500"
                  : theme === "dark"
                    ? "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-slate-200/50",
              )}
              title="Ẩn/Hiện thông số AI & Telemetry"
            >
              <Activity className="w-4 h-4" />
            </button>

            {hasCapturedImages && onOpenReview && (
              <button
                onClick={onOpenReview}
                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0"
              >
                <Images className="w-3.5 h-3.5" />
                <span>Xem kết quả</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* ── Main Viewport & Live Shot Sidebar ── */}
      <main className="w-full flex-1 flex items-center justify-center relative overflow-hidden px-2 sm:px-4 py-2 z-10">
        <div className="w-full h-full max-w-6xl flex items-center justify-center gap-4">
          {/* Left Live Shot Gallery Sidebar - Clean Borderless Design */}
          {!isFullscreen && (
            <div className="hidden sm:flex flex-col gap-2 w-36 shrink-0 h-full max-h-[82vh] p-1">
              <div
                className={cn(
                  "flex items-center justify-between pb-1.5 border-b",
                  theme === "dark" ? "border-slate-800/80" : "border-slate-200",
                )}
              >
                <span
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-wider flex items-center gap-1",
                    theme === "dark" ? "text-slate-300" : "text-slate-700",
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  Ảnh 5 Hướng
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
                {steps.map((step, idx) => {
                  const isCompleted = idx < guidance.currentStepIndex;
                  const isActiveNextSlot =
                    idx === guidance.currentStepIndex && isWorkflowStarted;

                  return (
                    <div
                      key={step.id}
                      className={cn(
                        "relative aspect-video rounded-xl border overflow-hidden flex flex-col items-center justify-center transition-all duration-300",
                        isCompleted
                          ? theme === "dark"
                            ? "bg-slate-900 border-emerald-500/60 text-emerald-400 shadow-md shadow-emerald-500/10"
                            : "bg-white border-emerald-400 text-emerald-700 shadow-sm"
                          : isActiveNextSlot
                            ? "bg-blue-500/10 border-blue-500 border-2 text-blue-500 animate-pulse shadow-[0_0_18px_rgba(59,130,246,0.4)]"
                            : theme === "dark"
                              ? "bg-slate-900/40 border-slate-800/80 text-slate-500 opacity-60"
                              : "bg-white/70 border-slate-200 text-slate-400",
                      )}
                    >
                      <span className="text-[11px] font-bold tracking-tight">
                        {step.label}
                      </span>

                      {/* Completed badge */}
                      {isCompleted && (
                        <div className="absolute top-1 right-1 bg-emerald-500/20 p-0.5 rounded-full border border-emerald-500/40">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        </div>
                      )}

                      {/* Active Next Slot Glowing Badge */}
                      {isActiveNextSlot && (
                        <div className="absolute bottom-1 px-1.5 py-0.2 rounded-full bg-blue-600 text-[9px] font-black text-white uppercase tracking-tighter shadow-md">
                          Đang chụp
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Center Stage: Live Camera Viewport */}
          <div
            ref={viewportRef}
            className={cn(
              "relative flex-1 transition-all duration-300 flex items-center justify-center h-full max-h-[85vh]",
              isFullscreen ? "w-full h-full rounded-none" : cameraWidthClass,
            )}
          >
            {/* Unified Sleek Camera Top Bar HUD (FPS + Face Status + Scale Controls) */}
            <div className="absolute top-3 inset-x-3 z-30 flex items-center justify-between pointer-events-none">
              {/* Left HUD: FPS & Face Status */}
              <div className="flex items-center gap-2 pointer-events-auto">
                {showScreenDebugStats && (
                  <div
                    className={cn(
                      "px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold border backdrop-blur-md flex items-center gap-1.5 shadow-sm",
                      theme === "dark"
                        ? "bg-slate-950/80 border-slate-800/80 text-emerald-400"
                        : "bg-white/90 border-slate-200/90 text-emerald-600",
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{cameraFps} FPS</span>
                    <span className="opacity-40">|</span>
                    <span
                      className={
                        theme === "dark" ? "text-purple-400" : "text-purple-600"
                      }
                    >
                      {cvFps} CV
                    </span>
                  </div>
                )}

                {faceState?.presence && (
                  <div
                    className={cn(
                      "px-2.5 py-1 rounded-xl text-[11px] font-bold border backdrop-blur-md shadow-sm transition-all",
                      faceState.presence === "SINGLE_FACE"
                        ? theme === "dark"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-emerald-50 text-emerald-700 border-emerald-300"
                        : faceState.presence === "MULTIPLE_FACES"
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                          : theme === "dark"
                            ? "bg-slate-900/80 text-slate-400 border-slate-800"
                            : "bg-white/90 text-slate-600 border-slate-200",
                    )}
                  >
                    {faceState.presence === "SINGLE_FACE"
                      ? "Single Face ✓"
                      : faceState.presence === "MULTIPLE_FACES"
                        ? `Cảnh báo: ${faceState.faceCount} mặt!`
                        : "Đang tìm mặt..."}
                  </div>
                )}
              </div>

              {/* Right HUD: Scale & Fullscreen Controls */}
              <TooltipProvider>
                <div
                  className={cn(
                    "hidden sm:flex pointer-events-auto items-center gap-1 p-1 rounded-xl border backdrop-blur-md shadow-sm",
                    theme === "dark"
                      ? "bg-slate-950/80 border-slate-800/80 text-slate-300"
                      : "bg-white/90 border-slate-200/90 text-slate-700",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={decreaseScale}
                        disabled={cameraScale === "compact" || isFullscreen}
                        className={cn(
                          "p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40",
                          theme === "dark"
                            ? "hover:bg-slate-800 text-slate-300"
                            : "hover:bg-slate-100 text-slate-700",
                        )}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" theme={theme}>
                      Giảm size (-)
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={increaseScale}
                        disabled={cameraScale === "large" || isFullscreen}
                        className={cn(
                          "p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40",
                          theme === "dark"
                            ? "hover:bg-slate-800 text-slate-300"
                            : "hover:bg-slate-100 text-slate-700",
                        )}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" theme={theme}>
                      Tăng size (+)
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={toggleFullscreen}
                        className={cn(
                          "p-1 rounded-lg text-xs transition-colors cursor-pointer",
                          isFullscreen
                            ? "bg-blue-600 text-white"
                            : theme === "dark"
                              ? "hover:bg-slate-800 text-slate-300"
                              : "hover:bg-slate-100 text-slate-700",
                        )}
                      >
                        {isFullscreen ? (
                          <Minimize className="w-3.5 h-3.5" />
                        ) : (
                          <Maximize className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" theme={theme}>
                      Toàn màn hình
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>

            {/* Camera Preview Canvas */}
            <CameraPreview
              stream={stream}
              aspectRatio={isFullscreen ? "auto" : "16/9"}
              className={cn(
                "w-full h-full overflow-hidden transition-all",
                isFullscreen
                  ? "w-screen h-screen rounded-none bg-black border-0"
                  : theme === "dark"
                    ? "rounded-2xl sm:rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/80"
                    : "rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-slate-900 shadow-lg shadow-slate-200/50",
              )}
            >
              {stream && (
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
                  alt="Snapshot Freeze"
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

              {!stream && (
                <div
                  className={cn(
                    "absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 z-20 pointer-events-auto transition-colors",
                    theme === "dark"
                      ? "bg-slate-950/95 text-slate-100"
                      : "bg-slate-50/95 text-slate-900",
                  )}
                >
                  {mode === "simulation" ? (
                    <>
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full flex items-center justify-center border shadow-md",
                          theme === "dark"
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                            : "bg-blue-50 border-blue-300 text-blue-600 shadow-blue-500/10",
                        )}
                      >
                        <Sliders className="w-7 h-7 text-blue-400 animate-pulse" />
                      </div>
                      <div className="text-center space-y-1 max-w-xs">
                        <h3
                          className={cn(
                            "text-sm font-bold",
                            theme === "dark"
                              ? "text-slate-200"
                              : "text-slate-800",
                          )}
                        >
                          Chế độ Mô phỏng (Simulation)
                        </h3>
                        <p
                          className={cn(
                            "text-xs font-medium",
                            theme === "dark"
                              ? "text-slate-400"
                              : "text-slate-500",
                          )}
                        >
                          Sử dụng các thanh trượt bên dưới để mô phỏng góc xoay
                          khuôn mặt & chất lượng ảnh
                        </p>
                      </div>
                    </>
                  ) : isCameraLoading ? (
                    <>
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full flex items-center justify-center border shadow-md",
                          theme === "dark"
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                            : "bg-blue-50 border-blue-300 text-blue-600 shadow-blue-500/10",
                        )}
                      >
                        <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
                      </div>
                      <div className="text-center space-y-1 max-w-xs">
                        <h3
                          className={cn(
                            "text-sm font-bold",
                            theme === "dark"
                              ? "text-slate-200"
                              : "text-slate-800",
                          )}
                        >
                          Đang khởi động Camera...
                        </h3>
                        <p
                          className={cn(
                            "text-xs font-medium",
                            theme === "dark"
                              ? "text-slate-400"
                              : "text-slate-500",
                          )}
                        >
                          Đang kết nối camera và nạp mô hình AI sinh trắc học
                        </p>
                      </div>
                      <button
                        disabled
                        className="mt-2 px-5 py-2 rounded-full bg-blue-600/60 text-white font-bold text-xs shadow-lg flex items-center gap-2 cursor-wait opacity-80"
                      >
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang khởi tạo...
                      </button>
                    </>
                  ) : cameraError ? (
                    <>
                      <div className="w-14 h-14 rounded-full flex items-center justify-center border border-rose-500/40 bg-rose-500/20 text-rose-400 shadow-md">
                        <AlertCircle className="w-7 h-7" />
                      </div>
                      <div className="text-center space-y-1 max-w-sm px-4">
                        <h3 className="text-sm font-bold text-rose-400">
                          Không thể mở Camera
                        </h3>
                        <p
                          className={cn(
                            "text-xs font-medium",
                            theme === "dark"
                              ? "text-slate-400"
                              : "text-slate-600",
                          )}
                        >
                          {cameraError}
                        </p>
                      </div>
                      {onStartLive && (
                        <button
                          onClick={onStartLive}
                          className="mt-2 px-5 py-2 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-500/30 transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Thử lại
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div
                        className={cn(
                          "w-14 h-14 rounded-full flex items-center justify-center border shadow-md",
                          theme === "dark"
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                            : "bg-blue-50 border-blue-300 text-blue-600 shadow-blue-500/10",
                        )}
                      >
                        <Camera className="w-7 h-7 animate-pulse" />
                      </div>
                      <div className="text-center space-y-1 max-w-xs">
                        <h3
                          className={cn(
                            "text-sm font-bold",
                            theme === "dark"
                              ? "text-slate-200"
                              : "text-slate-800",
                          )}
                        >
                          Live Camera
                        </h3>
                        <p
                          className={cn(
                            "text-xs font-medium",
                            theme === "dark"
                              ? "text-slate-400"
                              : "text-slate-500",
                          )}
                        >
                          Khởi động camera để bắt đầu quy trình chụp sinh trắc
                          học
                        </p>
                      </div>
                      {onStartLive && (
                        <button
                          onClick={onStartLive}
                          className="mt-2 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
                        >
                          <Play className="w-4 h-4 fill-white" />
                          Bật Camera
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {captureMode === "MANUAL" && (
                <GestureOverlay
                  gestureState={gestureState}
                  gestureProgress={gestureProgress}
                  faceReady={
                    faceState?.detected === true &&
                    faceState?.presence === "SINGLE_FACE" &&
                    faceState?.quality?.accepted === true
                  }
                />
              )}

              {captureMode === "OFF" && onShutterCapture && (
                <ShutterButton
                  className="pointer-events-auto"
                  enabled={
                    faceState?.detected === true &&
                    faceState?.presence === "SINGLE_FACE" &&
                    faceState?.quality?.accepted === true
                  }
                  onCapture={onShutterCapture}
                />
              )}

              {stabilityProgress > 0 && captureMode === "AUTO" && (
                <div className="absolute bottom-16 sm:bottom-4 left-1/2 -translate-x-1/2 w-48 sm:w-56 z-20">
                  <StabilityProgress
                    progress={stabilityProgress}
                    text="Giữ nguyên tư thế..."
                  />
                </div>
              )}
            </CameraPreview>
          </div>

          {/* Right Side: Sleek 2-Tab Glass Slide-Over Drawer (Never Clipped, Fits All Window Sizes) */}
          {showTelemetryDrawer && !isFullscreen && (
            <aside
              className={cn(
                "absolute right-2 sm:right-4 top-2 bottom-2 z-40 flex flex-col w-80 sm:w-84 max-w-[calc(100vw-2rem)] rounded-3xl border p-3.5 sm:p-4 shadow-2xl backdrop-blur-3xl transition-all animate-in slide-in-from-right-6 duration-300 select-none",
                theme === "dark"
                  ? "bg-slate-900/95 border-slate-800 text-slate-100 shadow-black/80"
                  : "bg-white/95 border-slate-200 text-slate-900 shadow-slate-300/50",
              )}
            >
              {/* Sidebar Header & Tab Switcher */}
              <div className="flex items-center justify-between pb-3 border-b mb-3 border-slate-800/30">
                <div
                  className={cn(
                    "flex items-center p-1 rounded-2xl border text-xs font-bold w-full gap-1 shadow-inner",
                    theme === "dark"
                      ? "bg-slate-950/80 border-slate-800/80"
                      : "bg-slate-100 border-slate-200/80",
                  )}
                >
                  <button
                    onClick={() => setActiveSidebarTab("debug")}
                    className={cn(
                      "flex-1 py-1.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 font-bold text-xs",
                      activeSidebarTab === "debug"
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                        : theme === "dark"
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Debug</span>
                  </button>

                  <button
                    onClick={() => setActiveSidebarTab("overlay")}
                    className={cn(
                      "flex-1 py-1.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 font-bold text-xs",
                      activeSidebarTab === "overlay"
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                        : theme === "dark"
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Overlay</span>
                  </button>
                </div>

                <button
                  onClick={() => setShowTelemetryDrawer(false)}
                  className="ml-2 text-slate-400 hover:text-rose-500 p-1.5 rounded-full hover:bg-rose-500/10 cursor-pointer transition-colors text-xs font-bold"
                  title="Đóng sidebar"
                >
                  ✕
                </button>
              </div>

              {/* Sidebar Scrollable Body */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs no-scrollbar">
                {activeSidebarTab === "debug" ? (
                  /* ═══════════ TAB 1: DEBUG TELEMETRY ═══════════ */
                  <div className="space-y-3.5 font-mono">
                    {/* Card 1: Performance Meters (Camera & CV Engine FPS) */}
                    <div
                      className={cn(
                        "p-3 rounded-2xl border space-y-2",
                        theme === "dark"
                          ? "bg-slate-950/60 border-slate-800/80"
                          : "bg-slate-50 border-slate-200",
                      )}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                          Performance Telemetry
                        </span>
                        <span className="text-[10px] text-emerald-400 font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                          LIVE
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center justify-center",
                            theme === "dark"
                              ? "bg-slate-900/80 border-slate-800"
                              : "bg-white border-slate-200",
                          )}
                        >
                          <span className="text-[9px] font-bold text-slate-400 uppercase">
                            Camera Stream
                          </span>
                          <span className="text-xl font-black text-blue-500">
                            {cameraFps}{" "}
                            <span className="text-xs font-bold text-slate-400">
                              FPS
                            </span>
                          </span>
                        </div>

                        <div
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center justify-center",
                            theme === "dark"
                              ? "bg-slate-900/80 border-slate-800"
                              : "bg-white border-slate-200",
                          )}
                        >
                          <span className="text-[9px] font-bold text-slate-400 uppercase">
                            CV Engine
                          </span>
                          <span className="text-xl font-black text-purple-500">
                            {cvFps}{" "}
                            <span className="text-xs font-bold text-slate-400">
                              FPS
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Face Presence & Biometric Status */}
                    {faceState && (
                      <div
                        className={cn(
                          "p-3 rounded-2xl border space-y-2.5",
                          theme === "dark"
                            ? "bg-slate-950/60 border-slate-800/80"
                            : "bg-slate-50 border-slate-200",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Crosshair className="w-3.5 h-3.5 text-purple-400" />
                            Trạng thái nhận diện
                          </span>
                          <span
                            className={cn(
                              "px-2.5 py-0.5 rounded-full font-extrabold text-[10px] uppercase border shadow-sm",
                              faceState.presence === "SINGLE_FACE"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                : faceState.presence === "MULTIPLE_FACES"
                                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                                  : "bg-rose-500/20 text-rose-400 border-rose-500/40",
                            )}
                          >
                            {faceState.presence || "NO_FACE"}
                          </span>
                        </div>

                        {/* Head Pose Angles (Yaw, Pitch, Roll) */}
                        <div className="space-y-1.5 pt-1 border-t border-slate-800/40">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1">
                              <Compass className="w-3.5 h-3.5 text-amber-400" />
                              Góc xoay (Y / P / R):
                            </span>
                            <span
                              className={cn(
                                "font-bold text-xs",
                                theme === "dark"
                                  ? "text-slate-100"
                                  : "text-slate-900",
                              )}
                            >
                              {Math.round(faceState.pose?.yaw || 0)}° /{" "}
                              {Math.round(faceState.pose?.pitch || 0)}° /{" "}
                              {Math.round(faceState.pose?.roll || 0)}°
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-center text-[9px] pt-1">
                            <div
                              className={cn(
                                "py-1 rounded-lg border",
                                theme === "dark"
                                  ? "bg-slate-900/60 border-slate-800 text-slate-300"
                                  : "bg-white border-slate-200 text-slate-700",
                              )}
                            >
                              Yaw:{" "}
                              <b className="text-blue-400">
                                {Math.round(faceState.pose?.yaw || 0)}°
                              </b>
                            </div>
                            <div
                              className={cn(
                                "py-1 rounded-lg border",
                                theme === "dark"
                                  ? "bg-slate-900/60 border-slate-800 text-slate-300"
                                  : "bg-white border-slate-200 text-slate-700",
                              )}
                            >
                              Pitch:{" "}
                              <b className="text-purple-400">
                                {Math.round(faceState.pose?.pitch || 0)}°
                              </b>
                            </div>
                            <div
                              className={cn(
                                "py-1 rounded-lg border",
                                theme === "dark"
                                  ? "bg-slate-900/60 border-slate-800 text-slate-300"
                                  : "bg-white border-slate-200 text-slate-700",
                              )}
                            >
                              Roll:{" "}
                              <b className="text-emerald-400">
                                {Math.round(faceState.pose?.roll || 0)}°
                              </b>
                            </div>
                          </div>
                        </div>

                        {/* Standing distance, so "step back" carries a number */}
                        {faceState.distance && (
                          <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/40">
                            <span className="text-slate-400 font-bold">Khoảng cách:</span>
                            <span className="font-mono font-bold text-blue-400">
                              ~{faceState.distance.meters.toFixed(2)} m
                              <span className="text-slate-500 font-normal ml-1">
                                ({faceState.distance.minMeters.toFixed(2)}–{faceState.distance.maxMeters.toFixed(2)})
                              </span>
                            </span>
                          </div>
                        )}

                        {/* Biometric Quality Check */}
                        {faceState.quality && (
                          <div className="space-y-1.5 pt-2 border-t border-slate-800/40">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400 font-bold">
                                Chất lượng sinh trắc:
                              </span>
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full font-bold text-[10px] border",
                                  faceState.quality.accepted
                                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                    : "bg-rose-500/20 text-rose-400 border-rose-500/40",
                                )}
                              >
                                {faceState.quality.accepted
                                  ? "ĐẠT CHUẨN ✓"
                                  : "KHÔNG ĐẠT ✕"}
                              </span>
                            </div>

                            {(() => {
                              const qualityReasons =
                                (faceState.quality as any)?.reasons ||
                                (faceState.quality as any)?.rejectReasons;
                              if (
                                !qualityReasons ||
                                qualityReasons.length === 0
                              )
                                return null;
                              return (
                                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] space-y-0.5">
                                  <span className="font-bold block">
                                    Lý do chưa đạt:
                                  </span>
                                  <ul className="list-disc list-inside">
                                    {qualityReasons.map(
                                      (r: string, i: number) => (
                                        <li key={i}>{r}</li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ═══════════ TAB 2: OVERLAY & AI CONFIG ═══════════ */
                  <div className="space-y-3.5">
                    {/* Card 1: FPS Telemetry HUD Toggle */}
                    {onToggleShowScreenDebugStats && (
                      <div
                        className={cn(
                          "p-3 rounded-2xl border flex items-center justify-between transition-all",
                          theme === "dark"
                            ? "bg-slate-950/60 border-slate-800/80"
                            : "bg-slate-50 border-slate-200",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Activity className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-xs block">
                              FPS Telemetry HUD
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Hiển thị FPS trực tiếp trên màn camera
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            onToggleShowScreenDebugStats(!showScreenDebugStats)
                          }
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border active:scale-95 shadow-sm",
                            showScreenDebugStats
                              ? "bg-emerald-600 border-emerald-500 text-white"
                              : theme === "dark"
                                ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                                : "bg-white border-slate-200 text-slate-600 hover:text-slate-900",
                          )}
                        >
                          {showScreenDebugStats ? "Bật" : "Tắt"}
                        </button>
                      </div>
                    )}

                    {/* Card 2: AI Sensitivity (5 Levels Segmented Control) */}
                    {handleSensitivityChange && (
                      <div
                        className={cn(
                          "p-3 rounded-2xl border space-y-2.5",
                          theme === "dark"
                            ? "bg-slate-950/60 border-slate-800/80"
                            : "bg-slate-50 border-slate-200",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <Gauge className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-xs">
                              Độ nhạy AI (Strictness)
                            </span>
                          </div>

                          <span className="text-[10px] text-amber-400 font-extrabold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">
                            {activeSensitivity === "VERY_LOW"
                              ? "Rất thấp"
                              : activeSensitivity === "LOW"
                                ? "Thấp"
                                : activeSensitivity === "MEDIUM"
                                  ? "Vừa"
                                  : activeSensitivity === "HIGH"
                                    ? "Cao"
                                    : "Rất cao"}
                          </span>
                        </div>

                        <div className="flex gap-1 p-1 rounded-xl bg-slate-950/40 border border-slate-800/60">
                          {[
                            { key: "VERY_LOW", label: "Rất thấp" },
                            { key: "LOW", label: "Thấp" },
                            { key: "MEDIUM", label: "Vừa" },
                            { key: "HIGH", label: "Cao" },
                            { key: "VERY_HIGH", label: "Rất cao" },
                          ].map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() =>
                                handleSensitivityChange(key as any)
                              }
                              className={cn(
                                "flex-1 py-1.5 px-0.5 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer truncate text-center active:scale-95",
                                activeSensitivity === key
                                  ? "bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-500"
                                  : theme === "dark"
                                    ? "text-slate-400 hover:text-slate-200"
                                    : "text-slate-600 hover:text-slate-900",
                              )}
                              title={label}
                            >
                              {label.slice(0, 3)}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight italic px-1">
                          {activeSensitivity === "VERY_LOW" &&
                            "• Dễ dãi nhất (ảnh hơi mờ hoặc tối vẫn vượt qua)"}
                          {activeSensitivity === "LOW" &&
                            "• Nới lỏng kiểm soát góc quay và độ sắc nét"}
                          {activeSensitivity === "MEDIUM" &&
                            "• Cân bằng tiêu chuẩn cho kiểm soát khuôn mặt sinh trắc"}
                          {activeSensitivity === "HIGH" &&
                            "• Yêu cầu rõ nét cao và hướng mặt chính xác"}
                          {activeSensitivity === "VERY_HIGH" &&
                            "• Siết chặt tiêu chuẩn dùng cho xác thực eKYC ngân hàng"}
                        </p>
                      </div>
                    )}

                    {/* Card 3: Capture Trigger Mode (AUTO / MANUAL / OFF) */}
                    {handleCaptureModeChange && (
                      <div
                        className={cn(
                          "p-3 rounded-2xl border space-y-3",
                          theme === "dark"
                            ? "bg-slate-950/60 border-slate-800/80"
                            : "bg-slate-50 border-slate-200",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            <Camera className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-xs block">
                              Chế độ chụp sinh trắc
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Chọn cách thức chụp tự động hoặc thủ công
                            </span>
                          </div>
                        </div>

                        {/* Segmented Mode Picker */}
                        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/40 border border-slate-800/60">
                          {(["AUTO", "MANUAL", "OFF"] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => handleCaptureModeChange(m)}
                              className={cn(
                                "py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer active:scale-95 text-center",
                                captureMode === m
                                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30 border border-violet-500"
                                  : theme === "dark"
                                    ? "text-slate-400 hover:text-slate-200"
                                    : "text-slate-600 hover:text-slate-900",
                              )}
                            >
                              {m}
                            </button>
                          ))}
                        </div>

                        {/* AUTO Mode: Hold Duration Slider */}
                        {captureMode === "AUTO" && handleAutoHoldMsChange && (
                          <div className="space-y-1.5 pt-2 border-t border-slate-800/40">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400 flex items-center gap-1.5 font-bold">
                                <Timer className="w-3.5 h-3.5 text-violet-400" />
                                Thời gian giữ (Hold):
                              </span>
                              <span className="font-black text-violet-400">
                                {(autoHoldMs / 1000).toFixed(1)}s
                              </span>
                            </div>
                            <input
                              type="range"
                              min="500"
                              max="5000"
                              step="250"
                              value={autoHoldMs}
                              onChange={(e) =>
                                handleAutoHoldMsChange(Number(e.target.value))
                              }
                              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                            />
                            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                              <span>0.5s</span>
                              <span>2.5s</span>
                              <span>5.0s</span>
                            </div>
                          </div>
                        )}

                        {/* MANUAL Mode: Gesture Cards Checklist */}
                        {captureMode === "MANUAL" &&
                          handleAllowedGesturesChange && (
                            <div className="space-y-2 pt-2 border-t border-slate-800/40">
                              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                                <Hand className="w-3.5 h-3.5 text-violet-400" />
                                Cử chỉ tay kích hoạt:
                              </span>
                              <div className="grid grid-cols-2 gap-1.5">
                                {[
                                  { key: "VICTORY", label: "✌ V-Sign" },
                                  { key: "THUMBS_UP", label: "👍 Thumbs Up" },
                                  { key: "OPEN_PALM", label: "✋ Open Palm" },
                                  { key: "CLOSED_FIST", label: "✊ Fist" },
                                  { key: "OK_SIGN", label: "👌 OK" },
                                ].map(({ key, label }) => {
                                  const active = allowedGestures.includes(
                                    key as any,
                                  );
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => {
                                        if (active) {
                                          const next = allowedGestures.filter(
                                            (g) => g !== key,
                                          );
                                          handleAllowedGesturesChange(
                                            next.length > 0
                                              ? next
                                              : allowedGestures,
                                          );
                                        } else {
                                          handleAllowedGesturesChange([
                                            ...allowedGestures,
                                            key as any,
                                          ]);
                                        }
                                      }}
                                      className={cn(
                                        "flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer active:scale-95",
                                        active
                                          ? "bg-violet-600/20 border-violet-500 text-violet-300 font-bold shadow-sm"
                                          : theme === "dark"
                                            ? "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
                                            : "bg-white border-slate-200 text-slate-600 hover:text-slate-900",
                                      )}
                                    >
                                      <span className="text-[11px]">
                                        {label}
                                      </span>
                                      <span
                                        className={
                                          active
                                            ? "text-violet-400 font-black text-xs"
                                            : "opacity-0"
                                        }
                                      >
                                        ✓
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Card 4: Frame Overlay (Khung Oval Sinh Trắc) */}
                    <div
                      className={cn(
                        "p-3 rounded-2xl border space-y-2.5",
                        theme === "dark"
                          ? "bg-slate-950/60 border-slate-800/80"
                          : "bg-slate-50 border-slate-200",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {overlayVisible ? (
                              <Eye className="w-4 h-4" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-slate-500" />
                            )}
                          </div>
                          <div>
                            <span className="font-bold text-xs block">
                              Khung Oval Sinh Trắc
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Khung định hình khuôn mặt
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={handleToggleOverlayVisible}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border active:scale-95 shadow-sm",
                            overlayVisible
                              ? "bg-blue-600 border-blue-500 text-white"
                              : theme === "dark"
                                ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                                : "bg-white border-slate-200 text-slate-600 hover:text-slate-900",
                          )}
                        >
                          {overlayVisible ? "Bật" : "Tắt"}
                        </button>
                      </div>

                      <div className="space-y-1 pt-1 border-t border-slate-800/40">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-bold">
                            Độ mờ khung (Opacity):
                          </span>
                          <span className="font-black text-blue-400">
                            {Math.round(overlayOpacity * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={overlayOpacity}
                          disabled={!overlayVisible}
                          onChange={(e) =>
                            handleOpacityChange(parseFloat(e.target.value))
                          }
                          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {/* Card 5: Landmarks Mesh (Điểm Mốc 468 Điểm) */}
                    {handleToggleLandmarks && (
                      <div
                        className={cn(
                          "p-3 rounded-2xl border space-y-2.5",
                          theme === "dark"
                            ? "bg-slate-950/60 border-slate-800/80"
                            : "bg-slate-50 border-slate-200",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CircleDot className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-bold text-xs block">
                                Điểm Mốc Landmarks
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Mesh 468 điểm sinh trắc học
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={handleToggleLandmarks}
                            className={cn(
                              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border active:scale-95 shadow-sm",
                              showLandmarks
                                ? "bg-emerald-600 border-emerald-500 text-white"
                                : theme === "dark"
                                  ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                                  : "bg-white border-slate-200 text-slate-600 hover:text-slate-900",
                            )}
                          >
                            {showLandmarks ? "Bật" : "Tắt"}
                          </button>
                        </div>

                        {handleLandmarkSizeChange && (
                          <div className="space-y-1 pt-1 border-t border-slate-800/40">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400 font-bold">
                                Kích thước điểm (Size):
                              </span>
                              <span className="font-black text-emerald-400">
                                {landmarkSize.toFixed(1)}px
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.3"
                              max="3.0"
                              step="0.1"
                              value={landmarkSize}
                              disabled={!showLandmarks}
                              onChange={(e) =>
                                handleLandmarkSizeChange(
                                  parseFloat(e.target.value),
                                )
                              }
                              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* ── Apple Compact Glass Controller Strip Footer ── */}
      {!isFullscreen && (
        <footer className="w-full z-20 mb-3 px-3 shrink-0 flex justify-center">
          <div
            className={cn(
              "w-full max-w-xl px-5 py-2.5 rounded-full border shadow-2xl flex items-center justify-between gap-3 transition-colors duration-300",
              theme === "dark"
                ? "bg-slate-900/85 border-slate-700/80 backdrop-blur-3xl text-slate-100"
                : "bg-white/95 border-slate-200/90 backdrop-blur-3xl text-slate-900 shadow-slate-200/60",
            )}
          >
            {!isWorkflowStarted && stream && onStartWorkflow ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      theme === "dark" ? "text-slate-200" : "text-slate-800",
                    )}
                  >
                    Camera sẵn sàng. Bấm Bắt đầu chụp 5 bước.
                  </span>
                </div>
                <button
                  onClick={onStartWorkflow}
                  className="px-5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/30 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  Bắt đầu
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 overflow-hidden">
                  <span
                    className={cn(
                      "px-2.5 py-0.5 rounded-full border text-[10px] font-extrabold uppercase shrink-0",
                      guidance.status === "READY" ||
                        guidance.status === "CAPTURING"
                        ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30"
                        : "bg-blue-500/20 text-blue-600 border-blue-500/30",
                    )}
                  >
                    {guidance.status}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold truncate",
                      theme === "dark" ? "text-slate-100" : "text-slate-900",
                    )}
                  >
                    {guidance.primaryInstruction}
                  </span>
                </div>

                {isWorkflowStarted && onCancel && (
                  <button
                    onClick={onCancel}
                    className={cn(
                      "px-3.5 py-1 rounded-full text-[11px] font-medium border active:scale-95 transition-all shrink-0 cursor-pointer flex items-center gap-1",
                      theme === "dark"
                        ? "bg-slate-800 hover:bg-rose-950/50 text-slate-300 hover:text-rose-200 border-slate-700 hover:border-rose-500/40"
                        : "bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border-slate-300 hover:border-rose-300",
                    )}
                  >
                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    <span>Hủy quy trình</span>
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      )}
    </div>
  );
};
