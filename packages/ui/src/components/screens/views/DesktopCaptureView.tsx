import React from "react";
import { Minus, Plus, Maximize, Minimize, Play, Camera, Images } from "lucide-react";
import { SharedCaptureViewProps } from "./types.js";
import { CameraPreview } from "../../camera/CameraPreview.js";
import { CameraSelector } from "../../camera/CameraSelector.js";
import { FaceOverlay } from "../../face/FaceOverlay.js";
import { GestureOverlay } from "../../face/GestureOverlay.js";
import { ShutterButton } from "../../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../../face/ShutterFlashOverlay.js";
import { FlyingThumbnail } from "../../face/FlyingThumbnail.js";
import { StepProgress } from "../../workflow/StepProgress.js";
import { GuidanceMessage } from "../../workflow/GuidanceMessage.js";
import { StabilityProgress } from "../../workflow/StabilityProgress.js";
import { CountdownTimer } from "../../workflow/CountdownTimer.js";
import { DebugPanel } from "../../debug/DebugPanel.js";
import { OverlayConfigPanel } from "../../debug/OverlayConfigPanel.js";
import { ThemeToggle } from "../../theme/ThemeToggle.js";
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
  } = props;

  return (
    <div
      className={cn(
        "relative w-full h-full min-h-screen flex flex-col justify-between items-center transition-colors duration-300 select-none overflow-x-hidden",
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

      {/* ── Top Header ── */}
      {!isFullscreen && (
        <header className="w-full px-2 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 pt-0.5 pb-0.5 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500 font-black text-xs sm:text-sm shrink-0 shadow-md">
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
            {hasCompletedSession && onOpenReview && (
              <button
                onClick={onOpenReview}
                className="px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] sm:text-xs shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer backdrop-blur-md shrink-0"
                title="Mở lại danh sách ảnh đã chụp"
              >
                <Images className="w-3.5 h-3.5 text-white" />
                <span>Xem kết quả</span>
              </button>
            )}
            {modeButton}
          </div>
        </header>
      )}

      {/* ── Steps Line (Horizontal StepProgress below header) ── */}
      {!isFullscreen && (
        <div className="w-full max-w-lg my-1 px-2 sm:px-0 shrink-0">
          <StepProgress
            steps={steps}
            currentStepIndex={guidance.currentStepIndex}
            theme={theme}
          />
        </div>
      )}

      {/* ── Main Content: 16:9 Landscape Camera Display ── */}
      <main
        className={cn(
          "w-full flex-1 flex flex-col items-center justify-center z-10 overflow-hidden",
          isFullscreen
            ? "fixed inset-0 p-0 m-0 z-40 bg-black"
            : "my-1 sm:my-2 px-1 sm:px-0",
        )}
      >
        <div
          ref={viewportRef}
          className={cn(
            "relative transition-all duration-300 flex items-center justify-center",
            isFullscreen
              ? "w-full h-full rounded-none"
              : cn("w-full", cameraWidthClass),
          )}
        >
          {/* ── 3 Control Buttons: "-" (Decrease), "+" (Increase), Fullscreen ── */}
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
            aspectRatio={isFullscreen ? "auto" : "16/9"}
            className={cn(
              "w-full overflow-hidden transition-all bg-transparent shadow-none",
              isFullscreen
                ? "w-screen h-screen rounded-none bg-black border-0"
                : "rounded-2xl sm:rounded-3xl sm:border sm:border-slate-200 dark:sm:border-slate-800",
            )}
          >
            {/* Top-Left Colored Text Debug Stats */}
            {showScreenDebugStats && renderTopLeftDebugOverlay()}
            {/* Live Diagnostic Reason & Presence Badge */}
            {renderFaceDiagnostics()}
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-transparent p-4 z-20 pointer-events-auto">
                <div
                  className={cn(
                    "w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg border backdrop-blur-md",
                    theme === "dark"
                      ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                      : "bg-blue-50 border-blue-300 text-blue-600",
                  )}
                >
                  <Camera className="w-6 h-6 sm:w-7 sm:h-7 animate-pulse" />
                </div>
                <div className="text-center space-y-0.5 max-w-xs">
                  <h3
                    className={cn(
                      "text-xs sm:text-sm font-bold",
                      theme === "dark" ? "text-slate-200" : "text-slate-800",
                    )}
                  >
                    Chế độ Live Camera
                  </h3>
                  <p
                    className={cn(
                      "text-[11px] font-medium",
                      theme === "dark" ? "text-slate-400" : "text-slate-500",
                    )}
                  >
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
                faceReady={
                  faceState?.detected === true &&
                  faceState?.presence === "SINGLE_FACE" &&
                  faceState?.quality?.accepted === true
                }
              />
            )}

            {/* Shutter Button (OFF mode) */}
            {mode === "live" && captureMode === "OFF" && onShutterCapture && (
              <ShutterButton
                enabled={
                  faceState?.detected === true &&
                  faceState?.presence === "SINGLE_FACE" &&
                  faceState?.quality?.accepted === true
                }
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

            {/* Fullscreen Desktop Guidance Overlay */}
            {isFullscreen && (
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

      {/* ── Guidance Message & Start Button Panel (Desktop Footer) ── */}
      {!isFullscreen && (
        <footer className="w-full max-w-md z-10 mt-2 sm:mt-4 mb-2 pb-2 px-2 sm:px-0">
          {!isWorkflowStarted && stream && onStartWorkflow ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <GuidanceMessage
                guidance={{
                  status: "READY",
                  primaryInstruction:
                    "Camera đã bật. Nhấn nút Bắt đầu để tiến hành chụp 5 bước.",
                  primaryReason: "READY",
                  progress: 0,
                  hints: faceState?.detected
                    ? [
                        {
                          code: "READY",
                          message: "Khuôn mặt đã nằm trong vị trí camera",
                        },
                      ]
                    : [
                        {
                          code: "NO_FACE",
                          message: "Vui lòng đứng trước camera",
                        },
                      ],
                  currentStepIndex: 0,
                  totalSteps: steps.length,
                  stepId: steps[0]?.id || "",
                  stepType: "FRONT",
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
              showScreenDebugStats={showScreenDebugStats}
              onToggleShowScreenDebugStats={onToggleShowScreenDebugStats}
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
