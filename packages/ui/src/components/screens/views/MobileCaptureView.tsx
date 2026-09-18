import React from "react";
import { Play, Camera, Images, XCircle } from "lucide-react";
import { SharedCaptureViewProps } from "./types.js";
import { CameraPreview, CAPTURE_MIRRORED } from "../../camera/CameraPreview.js";
import { CameraSelector } from "../../camera/CameraSelector.js";
import { FaceOverlay } from "../../face/FaceOverlay.js";
import { GestureOverlay } from "../../face/GestureOverlay.js";
import { ShutterButton } from "../../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../../face/ShutterFlashOverlay.js";
import { FlyingThumbnail } from "../../face/FlyingThumbnail.js";
import { StepProgress } from "../../workflow/StepProgress.js";
import { StabilityProgress } from "../../workflow/StabilityProgress.js";
import { CountdownTimer } from "../../workflow/CountdownTimer.js";
import { FramesBlockedPanel } from "../../camera/FramesBlockedPanel.js";
import { ThemeToggle } from "../../theme/ThemeToggle.js";
import { LookaIcon } from "../../theme/LookaIcon.js";
import { cn } from "../../../lib/utils.js";

export const MobileCaptureView: React.FC<SharedCaptureViewProps> = (props) => {
  const {
    stream,
    zoomScale,
    zoomOrigin,
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
    modeButton,
    onCancel,
    onStartLive,
    isWorkflowStarted,
    onStartWorkflow,
    onOpenReview,
    hasCapturedImages,
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
    multiFrame,
  } = props;

  // WorkflowEngine tracks pose stability (guidance.status can read
  // STABILIZING/CAPTURING) regardless of captureMode, but only AUTO mode
  // ever turns that into an actual capture — MANUAL waits for a held
  // gesture, OFF waits for the shutter button. Showing the raw status (and
  // the step's pose instruction) in those modes told the operator a photo
  // was about to be taken automatically when it never would be — see the
  // identical fix in DesktopCaptureView for the same reasoning.
  const isAutoOnlyReadyStatus = guidance.status === "STABILIZING" || guidance.status === "CAPTURING";
  const showsAutoOnlyReady = captureMode !== "AUTO" && isAutoOnlyReadyStatus;
  const displayStatus = showsAutoOnlyReady ? "READY" : guidance.status;
  const displayInstruction = showsAutoOnlyReady
    ? captureMode === "OFF"
      ? "Bấm nút chụp"
      : "Giơ cử chỉ tay để chụp"
    : guidance.primaryInstruction;

  return (
    <div
      className={cn(
        // Was h-[100dvh] — this view renders inside device-layout's own
        // resizable kiosk window, not always the full browser viewport (see
        // GuidedCaptureScreen's rootRef doc comment), so sizing off the raw
        // dynamic viewport height left dead space or clipped content
        // whenever that window was shorter than the outer viewport. h-full
        // fills whatever height the parent container actually has, matching
        // DesktopCaptureView's own root sizing.
        "relative w-full h-full flex flex-col justify-between items-center transition-colors duration-300 select-none overflow-hidden p-0 m-0 bg-kiosk-bg text-kiosk-text",
        className,
      )}
    >
      {/* ── Top Header with Integrated Step Timeline ── */}
      {/*
        flex-wrap (+ gap-y) — same fix as DesktopCaptureView's header: the
        right-hand cluster (camera selector, modeButton's Mô phỏng/Live
        Camera toggle, and — desktop-app only — Cài đặt camera/Màn hình mở
        rộng) is shrink-0 and can outgrow what's left beside the brand mark
        and step pill at the 640px minimum window width. Wrapping to a
        second line keeps every control reachable instead of clipping it.
      */}
      <header className="w-full px-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 py-2 shrink-0 z-30 border-b border-kiosk-border bg-kiosk-bg/90">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-7 w-7 shrink-0">
            <LookaIcon className="h-full w-full" />
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

          {/*
            Same dead-prop bug as DesktopCaptureView had — `modeButton`
            reached this component via GuidedCaptureScreen's sharedProps but
            was never destructured or rendered, so the Mô phỏng/Live Camera
            toggle was unreachable on narrow (<768px) viewports too.
          */}
          {modeButton}

          {onToggleTheme && (
            <ThemeToggle
              theme={theme}
              onToggleTheme={onToggleTheme}
              className="border border-kiosk-border bg-kiosk-surface"
            />
          )}

          {hasCapturedImages && onOpenReview && (
            <button
              onClick={onOpenReview}
              className="px-2.5 py-1 rounded-lg bg-kiosk-accent text-kiosk-bg font-bold text-[11px] shadow-md flex items-center gap-1 active:scale-95 cursor-pointer shrink-0"
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
            // Product decision 2026-09-05: the capture preview behaves like a
            // mirror again for self-positioning. As of product decision
            // 2026-09-17 (2026-09-18 fix: extended to every camera role),
            // the saved still matches this too — see
            // BrowserCameraService.mirrorStills's own doc comment.
            mirrored={CAPTURE_MIRRORED}
            zoomScale={zoomScale}
            zoomOrigin={zoomOrigin}
            aspectRatio="auto"
            className="w-full h-full flex-1 rounded-3xl overflow-hidden transition-all shadow-xl border border-kiosk-border bg-kiosk-bg"
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
                mirrored={CAPTURE_MIRRORED}
                variant="capture"
                // See DesktopCaptureView's identical comment: only AUTO ever
                // acts on stability, so the countdown ring must not appear
                // in MANUAL/OFF.
                stabilityProgress={captureMode === "AUTO" ? stabilityProgress : 0}
                autoHoldMs={autoHoldMs}
              />
            )}
            <CountdownTimer value={countdownValue} />
            {freezeSnapshot && (
              <img
                src={freezeSnapshot}
                alt="Snapshot Freeze"
                // 2026-09-18 field bug fix — see DesktopCaptureView.tsx's
                // identical fix for the full explanation: `freezeSnapshot`
                // is now already pixel-mirrored at the source (product
                // decision 2026-09-17), so re-applying scale-x-[-1] here
                // flipped it back to looking unmirrored.
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-kiosk-bg/90 p-4 z-20 pointer-events-auto">
                <div className="w-12 h-12 rounded-full bg-kiosk-accent/15 border border-kiosk-accent/40 text-kiosk-accent flex items-center justify-center shadow-lg">
                  <Camera className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-center space-y-0.5 max-w-xs">
                  <h3 className="text-xs font-bold text-kiosk-text">Live Camera</h3>
                  <p className="text-[11px] font-medium text-kiosk-text-muted">Bấm nút bên dưới để khởi động camera</p>
                </div>
                {onStartLive && (
                  <button
                    onClick={onStartLive}
                    className="mt-1 px-4 py-2 rounded-full bg-kiosk-accent hover:brightness-110 text-kiosk-bg font-bold text-xs shadow-lg shadow-kiosk-accent/30 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
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
                  faceState?.quality?.accepted === true &&
                  // 2026-09-05 black-frame fix — see the identical gate in
                  // DesktopCaptureView for the full reasoning.
                  (!multiFrame || multiFrame.allSideFramesReady)
                }
                disabledHint={
                  multiFrame && !multiFrame.allSideFramesReady && multiFrame.notReadyRoleLabel
                    ? `Đang chờ camera ${multiFrame.notReadyRoleLabel}…`
                    : undefined
                }
                onCapture={onShutterCapture}
              />
            )}

            {stabilityProgress > 0 && captureMode === "AUTO" && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-48 z-20">
                <StabilityProgress progress={stabilityProgress} text="Giữ nguyên tư thế..." />
              </div>
            )}

            {/*
              Multi-frame simultaneous capture (§ desktop kiosk multi-camera
              capture) — mobile renders only the blocked panel, never the
              grid (no room for it on a phone screen); `multiFrame` is only
              ever passed while the campaign's `simultaneousCapture` flag is
              on and the kiosk is in live mode.
            */}
            {multiFrame?.blocked && !multiFrame.blocked.ok && (
              <FramesBlockedPanel
                className="pointer-events-auto"
                preflight={multiFrame.blocked}
                onOpenCameraSetup={multiFrame.onOpenCameraSetup}
                onRecheck={multiFrame.onRecheck}
                theme={theme}
              />
            )}

            {/* Mobile Overlayed Controller Strip */}
            {stream && (
              <div className="absolute bottom-3 inset-x-2 z-40 flex flex-col items-center gap-2 pointer-events-auto text-center">
                <div className="w-full px-4 py-2.5 rounded-full border border-kiosk-border bg-kiosk-bg/85 text-kiosk-text shadow-2xl backdrop-blur-2xl flex items-center justify-between gap-2">
                  {!isWorkflowStarted && onStartWorkflow ? (
                    <>
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full bg-kiosk-accent-2 animate-pulse" />
                        <span className="truncate">Camera sẵn sàng</span>
                      </div>
                      <button
                        onClick={onStartWorkflow}
                        className="px-4 py-1.5 rounded-full bg-kiosk-accent hover:brightness-110 text-kiosk-bg font-bold text-xs shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Bắt đầu
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full border text-[9px] font-extrabold uppercase shrink-0",
                          displayStatus === 'READY' || displayStatus === 'CAPTURING'
                            ? "bg-kiosk-accent-2/15 text-kiosk-accent-2 border-kiosk-accent-2/30"
                            : "bg-kiosk-accent/15 text-kiosk-accent border-kiosk-accent/30"
                        )}>
                          {displayStatus}
                        </span>
                        <span className="text-xs font-semibold truncate">
                          {displayInstruction}
                        </span>
                      </div>
                      {onCancel && (
                        <button
                          onClick={onCancel}
                          className="p-1 rounded-full text-kiosk-text-muted hover:text-kiosk-danger active:scale-95 cursor-pointer shrink-0"
                          title="Hủy quy trình"
                        >
                          <XCircle className="w-4 h-4 text-kiosk-danger" />
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

