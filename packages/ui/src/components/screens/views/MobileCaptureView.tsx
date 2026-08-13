import React from "react";
import { Play, Camera, Images } from "lucide-react";
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
import { OverlayConfigPanel } from "../../debug/OverlayConfigPanel.js";
import { ThemeToggle } from "../../theme/ThemeToggle.js";
import { cn } from "../../../lib/utils.js";

export const MobileCaptureView: React.FC<SharedCaptureViewProps> = (props) => {
  const {
    stream,
    faceState,
    guidance,
    steps,
    devices,
    selectedDeviceId,
    onSelectDevice,
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
        "relative w-full h-[100dvh] flex flex-col justify-between items-center transition-colors duration-300 select-none overflow-hidden p-0 m-0",
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900",
        className,
      )}
    >
      {/* ── Fixed Top-Right Theme Toggle & Camera Selector ── */}
      <div className="fixed top-2 right-2 z-[60] flex items-center gap-1.5">
        {devices && devices.length > 1 && (
          <CameraSelector
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={onSelectDevice}
          />
        )}
        {onToggleTheme && <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />}
      </div>

      {/* ── Top Header ── */}
      <header className="w-full px-3 flex items-center justify-between gap-2 pt-2 pb-1 shrink-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500 font-black text-xs shrink-0 shadow-md">
            FP
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-tight leading-tight">
              Face Capture
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5 pr-8">
          {hasCompletedSession && onOpenReview && (
            <button
              onClick={onOpenReview}
              className="px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] shadow-md flex items-center gap-1 transition-all active:scale-95 cursor-pointer backdrop-blur-md shrink-0"
              title="Mở lại danh sách ảnh đã chụp"
            >
              <Images className="w-3.5 h-3.5 text-white" />
              <span>Xem kết quả</span>
            </button>
          )}
          {modeButton}
        </div>
      </header>
      {/* ── Steps Line (Positioned below header, above camera view) ── */}
      <div className="w-full max-w-sm px-3 pt-1 pb-1 shrink-0 z-30">
        <StepProgress
          steps={steps}
          currentStepIndex={guidance.currentStepIndex}
          theme={theme}
        />
      </div>

      {/* ── Main Content: Extended Portrait Camera Display ── */}
      <main className="w-full flex-1 flex flex-col items-center justify-start z-10 overflow-hidden my-0 px-0 max-w-sm pt-1 pb-2">
        <div
          ref={viewportRef}
          className="relative transition-all duration-300 flex items-center justify-center w-full flex-1 h-full max-w-sm mx-auto"
        >
          {/* Camera Preview */}
          <CameraPreview
            stream={stream}
            aspectRatio="auto"
            className="w-full h-full flex-1 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 overflow-hidden transition-all bg-transparent shadow-none"
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
                    "w-12 h-12 rounded-full flex items-center justify-center shadow-lg border backdrop-blur-md",
                    theme === "dark"
                      ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                      : "bg-blue-50 border-blue-300 text-blue-600",
                  )}
                >
                  <Camera className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-0.5 max-w-xs">
                  <h3
                    className={cn(
                      "text-xs font-bold",
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
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-48 z-20">
                <StabilityProgress
                  progress={stabilityProgress}
                  text="Giữ nguyên tư thế..."
                />
              </div>
            )}



            {/* Mobile Overlayed Pre-Start & Guidance (Inside Camera View at Bottom) */}
            {stream && (
              <div className="absolute bottom-4 inset-x-0 z-40 flex flex-col items-center gap-2 px-3 pointer-events-auto text-center">
                {!isWorkflowStarted && onStartWorkflow ? (
                  <div
                    className={cn(
                      "px-5 py-3 rounded-3xl backdrop-blur-2xl transition-all duration-300 flex flex-col items-center gap-2 max-w-[290px]",
                      theme === "dark"
                        ? "bg-slate-950/50 border border-white/20 text-white shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.4),0_12px_32px_rgba(0,0,0,0.5)]"
                        : "bg-white/65 border border-white/70 text-slate-900 shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.9),0_12px_32px_rgba(0,0,0,0.08)]",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Camera đã bật</span>
                    </div>
                    <p
                      className={cn(
                        "text-[11px] font-medium text-center",
                        theme === "dark" ? "text-slate-300" : "text-slate-600",
                      )}
                    >
                      Nhấn Bắt đầu để thực hiện quy trình chụp
                    </p>
                    <button
                      onClick={onStartWorkflow}
                      className="mt-0.5 px-5 py-1.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all duration-300 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      Bắt đầu
                    </button>
                  </div>
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
          </CameraPreview>
        </div>
      </main>

      {/* ── Overlay Config Panel for Mobile (if live mode) ── */}
      {showDebugPanel && mode === "live" && (
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
          isFullscreen={false}
          defaultPosition={{ x: 10, y: 100 }}
        />
      )}
    </div>
  );
};
