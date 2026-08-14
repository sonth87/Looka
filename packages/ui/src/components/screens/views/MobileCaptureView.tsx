import React from "react";
import { Play, Camera, Images, Sun, Moon, XCircle } from "lucide-react";
import { SharedCaptureViewProps } from "./types.js";
import { CameraPreview } from "../../camera/CameraPreview.js";
import { CameraSelector } from "../../camera/CameraSelector.js";
import { FaceOverlay } from "../../face/FaceOverlay.js";
import { GestureOverlay } from "../../face/GestureOverlay.js";
import { ShutterButton } from "../../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../../face/ShutterFlashOverlay.js";
import { FlyingThumbnail } from "../../face/FlyingThumbnail.js";
import { StepProgress } from "../../workflow/StepProgress.js";
import { StabilityProgress } from "../../workflow/StabilityProgress.js";
import { CountdownTimer } from "../../workflow/CountdownTimer.js";
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
    theme = "dark",
    onToggleTheme,
    onCancel,
    onStartLive,
    isWorkflowStarted,
    onStartWorkflow,
    onOpenReview,
    hasCompletedSession,
    showScreenDebugStats,
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
      {/* ── Top Header with Integrated Step Timeline ── */}
      <header className={cn(
        "w-full px-3 flex items-center justify-between gap-2 py-2 shrink-0 z-30 border-b transition-colors duration-300",
        theme === "dark" ? "border-slate-800/80 bg-slate-950/90 text-slate-100" : "border-slate-200/90 bg-white/90 text-slate-900 shadow-sm"
      )}>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-xs shrink-0 shadow-md">
            LK
          </div>
          <h1 className="text-xs font-bold tracking-tight hidden xs:block">Looka</h1>
        </div>

        {/* Integrated Center StepProgress Timeline */}
        <div className="flex-1 max-w-xs px-1 overflow-visible">
          <StepProgress
            steps={steps}
            currentStepIndex={guidance.currentStepIndex}
            theme={theme}
            compact={true}
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {devices && devices.length > 1 && (
            <CameraSelector
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onSelectDevice={onSelectDevice}
            />
          )}

          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 shadow-sm",
                theme === "dark"
                  ? "bg-slate-900 border-slate-800 text-amber-400 hover:bg-slate-800"
                  : "bg-white border-slate-200 text-purple-600 hover:bg-slate-100 shadow-slate-200"
              )}
              title={theme === "dark" ? "Chuyển sang Giao diện Sáng" : "Chuyển sang Giao diện Tối"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-purple-600" />}
            </button>
          )}

          {hasCompletedSession && onOpenReview && (
            <button
              onClick={onOpenReview}
              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] shadow-md flex items-center gap-1 active:scale-95 cursor-pointer shrink-0"
            >
              <Images className="w-3.5 h-3.5" />
              <span>Xem</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Main Content: Extended Portrait Camera Display ── */}
      <main className="w-full flex-1 flex flex-col items-center justify-start z-10 overflow-hidden my-0 px-2 max-w-sm pt-1 pb-2">
        <div
          ref={viewportRef}
          className="relative transition-all duration-300 flex items-center justify-center w-full flex-1 h-full max-w-sm mx-auto"
        >
          <CameraPreview
            stream={stream}
            aspectRatio="auto"
            className={cn(
              "w-full h-full flex-1 rounded-3xl overflow-hidden transition-all shadow-xl",
              theme === "dark" ? "border border-slate-800 bg-slate-950" : "border border-slate-200 bg-slate-900"
            )}
          >
            {showScreenDebugStats && renderTopLeftDebugOverlay()}
            {renderFaceDiagnostics()}
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4 z-20 pointer-events-auto">
                <div className="w-12 h-12 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center shadow-lg">
                  <Camera className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-0.5 max-w-xs">
                  <h3 className="text-xs font-bold text-slate-200">Live Camera</h3>
                  <p className="text-[11px] font-medium text-slate-400">Bấm nút bên dưới để khởi động camera</p>
                </div>
                {onStartLive && (
                  <button
                    onClick={onStartLive}
                    className="mt-1 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Bắt đầu
                  </button>
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
                enabled={
                  faceState?.detected === true &&
                  faceState?.presence === "SINGLE_FACE" &&
                  faceState?.quality?.accepted === true
                }
                onCapture={onShutterCapture}
              />
            )}

            {stabilityProgress > 0 && captureMode === "AUTO" && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-48 z-20">
                <StabilityProgress progress={stabilityProgress} text="Giữ nguyên tư thế..." />
              </div>
            )}

            {/* Mobile Overlayed Controller Strip */}
            {stream && (
              <div className="absolute bottom-3 inset-x-2 z-40 flex flex-col items-center gap-2 pointer-events-auto text-center">
                <div className={cn(
                  "w-full px-4 py-2.5 rounded-full border shadow-2xl backdrop-blur-2xl flex items-center justify-between gap-2 transition-colors duration-300",
                  theme === "dark"
                    ? "bg-slate-950/85 border-slate-800 text-slate-100"
                    : "bg-white/95 border-slate-200 text-slate-900 shadow-slate-300/60"
                )}>
                  {!isWorkflowStarted && onStartWorkflow ? (
                    <>
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="truncate">Camera sẵn sàng</span>
                      </div>
                      <button
                        onClick={onStartWorkflow}
                        className="px-4 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Play className="w-3 h-3 fill-white" />
                        Bắt đầu
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full border text-[9px] font-extrabold uppercase shrink-0",
                          guidance.status === 'READY' || guidance.status === 'CAPTURING'
                            ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                            : "bg-blue-500/20 text-blue-500 border-blue-500/30"
                        )}>
                          {guidance.status}
                        </span>
                        <span className="text-xs font-semibold truncate">
                          {guidance.primaryInstruction}
                        </span>
                      </div>
                      {onCancel && (
                        <button
                          onClick={onCancel}
                          className="p-1 rounded-full text-slate-400 hover:text-rose-500 active:scale-95 cursor-pointer shrink-0"
                          title="Hủy quy trình"
                        >
                          <XCircle className="w-4 h-4 text-rose-500" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </CameraPreview>
        </div>
      </main>
    </div>
  );
};

