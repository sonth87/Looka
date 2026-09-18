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
import { CameraPreview, CAPTURE_MIRRORED } from "../../camera/CameraPreview.js";
import { CameraSelector } from "../../camera/CameraSelector.js";
import { FaceOverlay } from "../../face/FaceOverlay.js";
import { CompositionGridOverlay } from "../../camera/CompositionGridOverlay.js";
import { GestureOverlay } from "../../face/GestureOverlay.js";
import { ShutterButton } from "../../face/ShutterButton.js";
import { ShutterFlashOverlay } from "../../face/ShutterFlashOverlay.js";
import { FlyingThumbnail } from "../../face/FlyingThumbnail.js";
import { StepProgress } from "../../workflow/StepProgress.js";
import { StabilityProgress } from "../../workflow/StabilityProgress.js";
import { CountdownTimer } from "../../workflow/CountdownTimer.js";
import { SubjectInfoBadge } from "../../workflow/SubjectInfoBadge.js";
import { CapturedListPanel } from "../../workflow/CapturedListPanel.js";
import {
  PhotoQualityChecklist,
  PhotoQualityCheckItem,
  PhotoQualityCheckStatus,
} from "../../workflow/PhotoQualityChecklist.js";
import { MultiFrameGrid } from "../../camera/MultiFrameGrid.js";
import { FramesBlockedPanel } from "../../camera/FramesBlockedPanel.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../../ui/tooltip.js";
import { cn } from "../../../lib/utils.js";
import { QUALITY_REASON_LABEL } from "../../../lib/qualityReasonLabels.js";

/**
 * The segmented picker below used to render the bare enum values
 * ("AUTO"/"MANUAL"/"OFF") with no explanation — an operator picking "MANUAL"
 * expecting a press-to-capture button got `GestureOverlay` instead (no
 * button at all; MANUAL triggers on a held hand gesture), since the actual
 * button only renders for `captureMode === "OFF"` (see this file's own
 * `captureMode === "OFF" && onShutterCapture` block further down).
 * 2026-09-08 fix: label each option with what it actually does instead of
 * its internal enum name, matching the wording `CampaignHomeScreen.tsx`'s
 * own `CAPTURE_MODE_LABEL` already uses for the same three values.
 */
const TRIGGER_MODE_LABEL: Record<"AUTO" | "MANUAL" | "OFF", string> = {
  AUTO: "Tự động",
  MANUAL: "Cử chỉ tay",
  OFF: "Bấm nút",
};

export const DesktopCaptureView: React.FC<SharedCaptureViewProps> = (props) => {
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
    cameraFps,
    cvFps,
    stabilityProgress,
    countdownValue,
    mode = "simulation",
    theme = "dark",
    onToggleTheme,
    modeButton,
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
    renderFaceDiagnostics,
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
    captureModeFromCampaign = false,
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
    multiFrame,
    subjectInfo,
    capturedList,
    recordingFailed,
  } = props;

  // Plan item 2, 2026-09-17: surfaces a camera whose video-recording channel
  // never started/died mid-session (see FaceCaptureApp.tsx's two recording
  // effects) — this used to reach only the console. No per-device role
  // mapping is threaded into this view (see this file's other comment on
  // `recordingFailed`), so this reports a count, not which physical camera —
  // still real, operator-visible signal instead of none at all.
  const failedRecordingCount = recordingFailed ? Object.values(recordingFailed).filter(Boolean).length : 0;

  const [showTelemetryDrawer, setShowTelemetryDrawer] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<
    "debug" | "overlay"
  >("debug");
  // Plan item 13, 2026-09-17 — collapses the new always-visible left-corner
  // "Đã chụp" panel below without removing it from the DOM; starts expanded
  // since the whole point of this fix is that it's visible by default now
  // (see this file's other comment on why the old placement never was).
  const [capturedPanelCollapsed, setCapturedPanelCollapsed] = useState(false);

  // Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture) —
  // `multiFrame` is only ever passed while the campaign's `simultaneousCapture`
  // flag is on and the kiosk is in live mode; undefined otherwise, which
  // keeps every branch below a no-op for the sequential single-camera path.
  const framesBlocked = !!(multiFrame?.blocked && !multiFrame.blocked.ok);

  // ── Bước 5 (4-cam grid) vs bước 6 (gương soi/mirror) — docs plan "Sửa UI
  // desktop app Looka theo 7 ảnh mockup". Both mockups are driven by this
  // exact same branch the rest of the file already uses for MultiFrameGrid.
  const hasMultiFrame = !!(multiFrame && multiFrame.frames.length > 0);
  const isMirrorMode = !hasMultiFrame;
  // The circular "gương soi" framing only applies outside fullscreen — in
  // fullscreen this view already strips all chrome (header, sidebars) down
  // to a bare full-bleed preview, and a giant circle clipped to the window
  // edges would look broken rather than intentional.
  const showMirrorChrome = isMirrorMode && !isFullscreen;

  const currentStep = steps[guidance.currentStepIndex] ?? null;

  // "●REC" + elapsed timer (bước 5 sidebar) — no per-channel "is this camera
  // actually recording right now" signal reaches this component (see
  // SharedCaptureViewProps.recordingFailed's own doc comment: only *failed*
  // channels are exposed, not a live recording flag), so this reads on the
  // one real signal that IS available here — `isWorkflowStarted`, the
  // multi-round capture session actually being underway — rather than
  // inventing a fake per-camera recording indicator. Elapsed time is
  // measured locally from the moment the session starts.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  React.useEffect(() => {
    if (!isWorkflowStarted) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isWorkflowStarted]);
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  // "TIẾN ĐỘ THU NHẬN KHUNG ẢNH: X/Y" — prefers the session-wide photo
  // count/target already computed by the caller (subjectInfo.photoCount/
  // photoTotal, the same numbers SubjectInfoBadge's own pill shows), falling
  // back to this round's frame-completion count when no subjectInfo was
  // handed down. Never a hardcoded number either way.
  const frameProgress = hasMultiFrame && multiFrame
    ? { count: multiFrame.frames.filter((f) => f.status === "COMPLETED").length, total: multiFrame.frames.length }
    : null;
  const progressLabel = subjectInfo
    ? `${subjectInfo.photoCount}/${subjectInfo.photoTotal}`
    : frameProgress
      ? `${frameProgress.count}/${frameProgress.total}`
      : null;

  // Same face-quality gate the on-canvas ShutterButton already uses (OFF
  // mode) — reused as-is for the new sidebar CTA button in bước 6, rather
  // than a second, possibly-drifting copy of the readiness rule.
  const isFaceReadyForCapture =
    faceState?.detected === true &&
    faceState?.presence === "SINGLE_FACE" &&
    faceState?.quality?.accepted === true;
  // The sidebar CTA reuses the exact same OFF-mode manual-shutter mechanism
  // as the existing on-canvas ShutterButton (see that button's own
  // `captureMode === "OFF" && onShutterCapture` condition below) — AUTO
  // fires itself once the pose stabilizes and MANUAL waits for a held
  // gesture, so this button has nothing new to trigger in those modes and
  // is shown disabled with the same real-time hint instead.
  const canManualCaptureFromSidebar = captureMode === "OFF" && !!onShutterCapture;

  // Bottom 3-phase progress dots (bước 6 — "Góc trước / Chụp ảnh và Sinh
  // trắc / Xác nhận thực hiện"). This is a coarser, higher-level phase than
  // the per-pose `steps` list (front/left/right/... angles), so it is not
  // built from StepProgress/steps — see this view's own report on why a
  // plain 3-dot row was used instead of reusing StepProgress here. Derived
  // from the same two real props already used elsewhere in this file:
  // `isWorkflowStarted` (actively capturing) and `hasCapturedImages` (at
  // least one photo saved this session) — `isWorkflowStarted` itself resets
  // to false both before a session starts AND right after one finishes, so
  // `hasCapturedImages` is what distinguishes "not started yet" from "just
  // finished" between sessions.
  const metaPhaseIndex = isWorkflowStarted ? 1 : hasCapturedImages ? 2 : 0;

  // "KIỂM TRA TIÊU CHUẨN ẢNH THẺ TỰ ĐỘNG" (bước 6 sidebar) — only 2 of the 4
  // ICAO-style criteria the mockup shows have a real signal anywhere in this
  // codebase today (brightness/TOO_DARK/TOO_BRIGHT for lighting,
  // eyeOpenScore/eyesVisible/EYES_CLOSED for eyes); background and attire
  // have no detector at all, so those two always render 'pending' with a
  // note rather than a fabricated 'valid' — see PhotoQualityChecklist's own
  // doc comment.
  const qualityHintCodes = new Set(guidance.hints.map((h) => h.code));
  const lightingStatus: PhotoQualityCheckStatus = !faceState?.quality
    ? "pending"
    : qualityHintCodes.has("TOO_DARK") || qualityHintCodes.has("TOO_BRIGHT")
      ? "warning"
      : faceState.quality.brightness != null
        ? "valid"
        : "pending";
  const eyesStatus: PhotoQualityCheckStatus = !faceState?.quality
    ? "pending"
    : qualityHintCodes.has("EYES_CLOSED")
      ? "warning"
      : faceState.quality.eyeOpenScore != null || faceState.quality.eyesVisible != null
        ? "valid"
        : "pending";
  const qualityChecklistItems: PhotoQualityCheckItem[] = [
    {
      id: "lighting",
      label: "Ánh sáng đồng đều, không đổ bóng",
      status: lightingStatus,
      note: lightingStatus === "pending" ? "Đang chờ đo độ sáng" : undefined,
    },
    {
      id: "background",
      label: "Nền trơn, màu trắng/kem",
      status: "pending",
      // TODO(workflow-engine): no background-segmentation signal exists yet
      // anywhere in this codebase — always 'pending' until one does.
      note: "Cần dữ liệu thật từ workflow-engine sau",
    },
    {
      id: "attire",
      label: "Trang phục lịch sự",
      status: "pending",
      // TODO(workflow-engine): no attire-detection signal exists yet either.
      note: "Cần dữ liệu thật từ workflow-engine sau",
    },
    {
      id: "eyes",
      label: "Mắt mở rõ nét",
      status: eyesStatus,
      note: eyesStatus === "pending" ? "Đang chờ nhận diện mắt" : undefined,
    },
  ];

  // WorkflowEngine tracks pose stability (guidance.status can read
  // STABILIZING/CAPTURING) regardless of captureMode, but only AUTO mode
  // ever turns that into an actual capture — MANUAL waits for a held
  // gesture, OFF waits for the shutter button. The footer pill below used to
  // show that raw status (and the step's pose instruction) even in those
  // modes, so an operator watched the badge say "CAPTURING" while nothing
  // was ever going to fire. Substitute the real next action instead,
  // whenever the pose itself is fine and only the trigger is still pending.
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
        "relative w-full h-full min-h-full flex flex-col justify-between items-center transition-colors duration-300 select-none overflow-hidden",
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900",
        className,
      )}
    >
      {/* ── Capture-specific toolbar (secondary bar) ──
        The persistent brand/clock header now lives in the shared
        `KioskShell`/`KioskHeader` one level up the tree (CampaignGate.tsx) —
        this screen renders inside that shell already, so the brand block and
        "Live Camera Ready"/"Standby" status dot this bar used to show are
        redundant duplicates of what the shell's own header already displays.
        Trimmed down to just the capture-specific controls (step pill, camera
        selector, mode toggle, theme toggle, telemetry-drawer toggle, "Xem
        kết quả") — docs plan "Sửa UI desktop app Looka theo 7 ảnh mockup".
        Kept on the fixed kiosk navy tokens (not the `theme`-driven
        dark/light slate palette the rest of this view still uses below) so
        it reads as one continuous bar with the shell header sitting directly
        above it, with no visible seam between the two.
      */}
      {!isFullscreen && (
        <header
          className={cn(
            // flex-wrap (+ gap-y) so the header degrades to a second line
            // instead of clipping once the right-hand control cluster (mode
            // toggle, camera setup, telemetry, theme) no longer fits beside
            // the step pill — measured to overflow the window's right edge
            // before this, since none of these shrink-0 groups could shrink
            // or wrap on their own.
            "w-full px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shrink-0 border-b border-kiosk-border bg-kiosk-bg/95 text-kiosk-text backdrop-blur-md z-30 transition-colors duration-300",
          )}
        >
          {/* Center: Inline Timeline StepProgress Pill (Collapses cleanly on narrow windows) */}
          {/*
            Was `w-full`, which forces this item to claim 100% of the
            header's width on every line — with `flex-wrap` above that meant
            it always pushed the right-hand controls to their own line even
            when there was room to share one. `flex-1` lets it grow/shrink
            like a normal flex item instead, so brand + steps + controls can
            still share a single row whenever the window is wide enough.
          */}
          <div className="hidden sm:flex items-center max-w-md flex-1 min-w-[160px] mx-2 shrink overflow-visible py-1">
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

            {/*
              Was a prop nobody rendered — `modeButton` (Mô phỏng/Live Camera
              toggle) reached this component via GuidedCaptureScreen's
              sharedProps but neither this view nor MobileCaptureView ever
              placed it in the tree, so the feature existed in code with no
              way to reach it from the UI. See FaceCaptureApp.tsx's own
              `modeButton` JSX for what this renders.
            */}
            {modeButton}

            {/*
              Theme Toggle Button (Identical w-8 h-8 size). This toolbar's
              own chrome stays on the fixed kiosk navy tokens regardless of
              `theme` (see this header's own doc comment above) — only the
              icon swaps to reflect what `theme` will become for the camera
              stage/footer/telemetry drawer below, which still do switch.
            */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 shadow-sm bg-kiosk-surface border-kiosk-border text-kiosk-warning hover:bg-kiosk-surface-2"
                title={
                  theme === "dark"
                    ? "Chuyển sang Giao diện Sáng"
                    : "Chuyển sang Giao diện Tối"
                }
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4 text-kiosk-warning" />
                ) : (
                  <Moon className="w-4 h-4 text-kiosk-accent" />
                )}
              </button>
            )}

            {/* AI Telemetry Toggle Button (Identical w-8 h-8 size) */}
            <button
              onClick={() => setShowTelemetryDrawer((prev) => !prev)}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border active:scale-95 shadow-sm",
                showTelemetryDrawer
                  ? "bg-kiosk-accent/20 border-kiosk-accent/50 text-kiosk-accent"
                  : "bg-kiosk-surface border-kiosk-border text-kiosk-text-muted hover:bg-kiosk-surface-2",
              )}
              title="Ẩn/Hiện thông số AI & Telemetry"
            >
              <Activity className="w-4 h-4" />
            </button>

            {hasCapturedImages && onOpenReview && (
              <button
                onClick={onOpenReview}
                className="px-2.5 py-1 rounded-lg bg-kiosk-accent hover:brightness-110 text-kiosk-bg font-bold text-[11px] shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0"
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
          {/*
            Left zone (ui-redesign-plan.md S5 "NGƯỜI ĐƯỢC CHỤP" + step
            gallery) — widened from w-36 to w-60 (~240px, matching the S5
            mockup's fixed left-column width) to make room for
            SubjectInfoBadge stacked above the existing step thumbnails.
          */}
          {!isFullscreen && (
            <div className="hidden sm:flex flex-col gap-2 w-60 shrink-0 h-full max-h-[82vh] p-1">
              {subjectInfo && (
                <SubjectInfoBadge
                  subject={subjectInfo.subject}
                  round={subjectInfo.round}
                  roundCount={subjectInfo.roundCount}
                  photoCount={subjectInfo.photoCount}
                  photoTotal={subjectInfo.photoTotal}
                  theme={theme}
                />
              )}

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
                  Ảnh {steps.length} Hướng
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
              // min-w-0 overrides the flex default of min-width:auto. Without
              // it, CameraPreview's aspect-video + h-full child gave this
              // flex-1 item a content-based minimum width (derived from its
              // own max-height via the aspect ratio) well above what
              // actually fit next to the sidebar at ~800px window width —
              // measured pushing this element ~140px past the window's right
              // edge, and the whole centered row (sidebar included) past its
              // left edge, both silently clipped by the ancestor's
              // overflow-hidden. min-w-0 lets it shrink to fill whatever
              // space is actually left, same as any ordinary flexible panel.
              "relative flex-1 min-w-0 transition-all duration-300 flex items-center h-full max-h-[85vh]",
              hasMultiFrame
                ? "flex-col justify-start gap-3 overflow-y-auto"
                // Bước 6 (gương soi): stacks the circular preview with the
                // new pose label/instruction text + phase dots below it (see
                // `showMirrorChrome` block after </CameraPreview>) instead of
                // just centering the one bare preview like before.
                : "flex-col justify-center gap-4 overflow-y-auto",
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

                  {/*
                    The header housing the normal "Xem kết quả" button is
                    hidden entirely in fullscreen (see `{!isFullscreen &&
                    (<header>...` above), which otherwise strands an operator
                    who toggled to the clean camera-only view with no way
                    back to already-captured photos short of guessing that
                    exiting fullscreen brings the header back. This HUD row
                    is not hidden in fullscreen, so mirroring the button here
                    keeps review reachable without leaving fullscreen. Only
                    rendered in fullscreen to avoid a second, redundant
                    button sitting right above the header's copy the rest of
                    the time.
                  */}
                  {isFullscreen && hasCapturedImages && onOpenReview && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={onOpenReview}
                          className="p-1 rounded-lg text-xs transition-colors cursor-pointer bg-blue-600 hover:bg-blue-500 text-white"
                        >
                          <Images className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" theme={theme}>
                        Xem kết quả
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TooltipProvider>
            </div>

            {/*
              Camera Preview Canvas — bước 6 (gương soi) clips this into a
              large circular "mirror" viewport with a dashed pose-guide ring
              drawn over it (below), a CSS wrapper around the exact same
              preview/overlay stack rather than a second camera-rendering
              path. Bước 5 (4-cam grid) and fullscreen are both unaffected —
              same 16:9/"auto" treatment as before.
            */}
            <CameraPreview
              stream={stream}
              // Product decision 2026-09-05: the capture preview behaves like
              // a mirror again for self-positioning. Product decision
              // 2026-09-17 (2026-09-18 fix: extended to every camera role,
              // not just CENTER) made the SAVED still match this too — see
              // BrowserCameraService.mirrorStills's own doc comment — so
              // this is now the one flag every mirrored surface, live or
              // saved, ultimately traces back to.
              mirrored={CAPTURE_MIRRORED}
              zoomScale={zoomScale}
              zoomOrigin={zoomOrigin}
              aspectRatio={isFullscreen ? "auto" : showMirrorChrome ? "1/1" : "16/9"}
              className={cn(
                "w-full h-full overflow-hidden transition-all",
                isFullscreen
                  ? "w-screen h-screen rounded-none bg-black border-0"
                  : theme === "dark"
                    ? "rounded-2xl sm:rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/80"
                    : "rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-slate-900 shadow-lg shadow-slate-200/50",
                showMirrorChrome &&
                  "rounded-full h-auto w-[min(92%,560px)] max-w-[560px] mx-auto border-2 border-kiosk-accent/60 shadow-[0_0_60px_-12px_rgba(34,211,238,0.5)]",
              )}
            >
              {/* Rule-of-thirds framing grid — this stage is always the CENTER camera (the CV-analysed feed), on by default per 2026-09-15 product decision. */}
              {stream && <CompositionGridOverlay />}

              {/*
                2026-09-18 field report: the "Phát hiện nhiều khuôn mặt! Chỉ
                đứng 1 người" banner (and the NO_FACE/quality-rejected
                diagnostics `renderFaceDiagnostics` also covers) stopped
                showing on the kiosk. Root cause: the Aug 13 2026 refactor
                that split this file out of the old monolithic
                GuidedCaptureScreen.tsx carried the call into
                MobileCaptureView.tsx but dropped it here — the desktop
                kiosk build (this component) never got it back, even though
                the underlying `faceState.presence` detection never stopped
                working. Restored verbatim, same placement
                MobileCaptureView.tsx uses (before the face overlay).
              */}
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
                  // The engine tracks pose stability (and can report
                  // STABILIZING/CAPTURING) regardless of captureMode, but only
                  // AUTO ever acts on it — MANUAL waits for a held gesture,
                  // OFF waits for the shutter button. Showing the countdown
                  // ring outside AUTO told the operator a photo was about to
                  // be taken automatically when it never would be.
                  stabilityProgress={captureMode === "AUTO" ? stabilityProgress : 0}
                  autoHoldMs={autoHoldMs}
                />
              )}

              {/*
                Person-silhouette guide ring (bước 6 gương soi) — a plain
                dashed head-oval + shoulder-arc drawn with SVG, not an image
                asset (none exists in this package), just enough to show
                where to position the face inside the circular viewport.
              */}
              {showMirrorChrome && (
                <div className="absolute inset-0 z-[6] flex items-center justify-center pointer-events-none">
                  <svg viewBox="0 0 200 200" className="w-[70%] h-[70%] opacity-70">
                    <ellipse
                      cx="100"
                      cy="82"
                      rx="46"
                      ry="58"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray="7 6"
                      className="text-kiosk-accent"
                    />
                    <path
                      d="M 18 196 Q 100 128 182 196"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray="7 6"
                      className="text-kiosk-accent"
                    />
                  </svg>
                </div>
              )}

              <CountdownTimer value={countdownValue} />

              {freezeSnapshot && (
                <img
                  src={freezeSnapshot}
                  alt="Snapshot Freeze"
                  // 2026-09-18 field bug fix: this used to re-apply
                  // scale-x-[-1] on top of `freezeSnapshot`, on the stale
                  // 2026-09-05 assumption that saved stills are always the
                  // raw unmirrored sensor image. Since product decision
                  // 2026-09-17 (`BrowserCameraService.setMirrorStills(true)`,
                  // extended to every camera role's still by this same fix),
                  // the file itself is already pixel-mirrored — re-mirroring
                  // it here flipped it right back to looking UNmirrored,
                  // visibly disagreeing with the live preview the operator
                  // just saw. Render it as-is now that the source data
                  // already matches the mirrored preview.
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
                    faceState?.quality?.accepted === true &&
                    // 2026-09-05 black-frame fix: in simultaneous-capture mode,
                    // every side frame must have actually rendered a real
                    // video frame before the shutter fires — see
                    // `allSideFramesReady` in lib/multiFrame.ts. Absent
                    // (`multiFrame` undefined, the sequential single-camera
                    // path) this is simply not checked, unchanged from before.
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
                <div className="absolute bottom-16 sm:bottom-4 left-1/2 -translate-x-1/2 w-48 sm:w-56 z-20">
                  <StabilityProgress
                    progress={stabilityProgress}
                    text="Giữ nguyên tư thế..."
                  />
                </div>
              )}

              {framesBlocked && multiFrame?.blocked && (
                <FramesBlockedPanel
                  className="pointer-events-auto"
                  preflight={multiFrame.blocked}
                  onOpenCameraSetup={multiFrame.onOpenCameraSetup}
                  onRecheck={multiFrame.onRecheck}
                  theme={theme}
                />
              )}
            </CameraPreview>

            {/*
              Bước 6 (gương soi) pose label/instruction/description below the
              circle — every string here comes from real `guidance`/`steps`
              state (current step index/label, the engine's own live
              instruction, its hint messages), never hardcoded copy.
            */}
            {showMirrorChrome && (
              <div className="w-full max-w-[560px] mx-auto flex flex-col items-center gap-1.5 text-center px-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-kiosk-accent">
                  {`Tư thế số ${Math.min(guidance.currentStepIndex + 1, Math.max(steps.length, 1))}${steps.length ? `/${steps.length}` : ""} trong đợt chụp`}
                </span>
                <h2
                  className={cn(
                    "text-lg sm:text-xl font-black uppercase tracking-wide",
                    theme === "dark" ? "text-white" : "text-slate-900",
                  )}
                >
                  {guidance.primaryInstruction}
                </h2>
                <p className="text-xs text-kiosk-text-muted max-w-sm">
                  {guidance.hints.length > 0
                    ? guidance.hints.map((h) => h.message).join(" · ")
                    : "Giữ đúng tư thế trong khung hình để hệ thống tự động chụp."}
                </p>
              </div>
            )}

            {/*
              Bottom 3-phase progress dots. Deliberately NOT StepProgress: it
              would misrepresent per-pose angle steps (front/left/right/...,
              already shown by the header pill + left thumbnail gallery) as
              this coarser 3-phase flow, which has different semantics
              entirely — see `metaPhaseIndex`'s own doc comment above for how
              this is derived from real props.
            */}
            {showMirrorChrome && (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {[
                  { key: "setup", label: "Góc trước" },
                  { key: "capture", label: "Chụp ảnh và Sinh trắc" },
                  { key: "confirm", label: "Xác nhận thực hiện" },
                ].map((phase, idx) => {
                  const isDone = idx < metaPhaseIndex;
                  const isActive = idx === metaPhaseIndex;
                  return (
                    <React.Fragment key={phase.key}>
                      <div
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border",
                          isDone
                            ? "bg-kiosk-accent-2/15 text-kiosk-accent-2 border-kiosk-accent-2/40"
                            : isActive
                              ? "bg-kiosk-accent/15 text-kiosk-accent border-kiosk-accent/50"
                              : "bg-kiosk-surface-2 text-kiosk-text-muted border-kiosk-border",
                        )}
                      >
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            isDone ? "bg-kiosk-accent-2" : isActive ? "bg-kiosk-accent" : "bg-kiosk-text-muted",
                          )}
                        />
                        {idx + 1}. {phase.label}
                      </div>
                      {idx < 2 && <span className="w-4 h-px bg-kiosk-border" />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {hasMultiFrame && (
              <MultiFrameGrid
                className="w-full shrink-0 px-1 pb-1"
                frames={multiFrame.frames}
                theme={theme}
                forceThreePerRow={multiFrame.grid3x3Enabled}
              />
            )}
          </div>

          {/*
            Right sidebar — mode-specific, per the docs plan "Sửa UI desktop
            app Looka theo 7 ảnh mockup":
            - Bước 5 (4-cam grid, `hasMultiFrame`): current-pose callout,
              ●REC/elapsed timer, "TIẾN ĐỘ THU NHẬN KHUNG ẢNH" progress line,
              and a vertical per-pose checklist (StepProgress's own data,
              `orientation="vertical"`).
            - Bước 6 (gương soi/mirror, single-frame): the new
              PhotoQualityChecklist + the big shutter CTA.
            The "ĐÃ CHỤP · ĐANG CHỤP" `CapturedListPanel` briefly lived in
            this column, then moved into the telemetry drawer's "Đã chụp"
            tab (hidden behind `showTelemetryDrawer`, and unconditionally
            hidden in fullscreen — i.e. effectively never visible on a real
            kiosk). Plan item 13 (2026-09-17) moves it again, this time to
            an always-visible bottom-left panel (see the `capturedPanelCollapsed`
            block below `<MultiFrameGrid>`/mirror preview) that renders
            regardless of `isFullscreen` or the drawer — same `capturedList`
            prop/data throughout, just a third placement.
          */}
          {!isFullscreen && (
            <div className="hidden lg:flex flex-col w-[300px] shrink-0 h-full max-h-[82vh] gap-3 p-1 overflow-y-auto">
              {hasMultiFrame ? (
                <>
                  {/* Current-pose callout — real step label + the engine's own live instruction, never hardcoded. */}
                  <Card variant="panel" className="p-3.5 flex items-start gap-3 border-kiosk-accent/40">
                    <div className="shrink-0 w-9 h-9 rounded-xl bg-kiosk-accent/15 text-kiosk-accent flex items-center justify-center">
                      <Compass className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-kiosk-accent">
                        {`Tư thế ${Math.min(guidance.currentStepIndex + 1, Math.max(steps.length, 1))}${currentStep ? `: ${currentStep.label}` : ""}`}
                      </div>
                      <div className="text-sm font-semibold text-kiosk-text mt-0.5 leading-snug">
                        {guidance.primaryInstruction}
                      </div>
                    </div>
                  </Card>

                  {/* ●REC (session actively running) + progress line — both from real props, see this component's own doc comments above. */}
                  <div className="flex items-center justify-between px-1 gap-2">
                    {isWorkflowStarted ? (
                      <div className="flex items-center gap-1.5 text-kiosk-danger text-xs font-bold shrink-0">
                        <span className="w-2 h-2 rounded-full bg-kiosk-danger animate-pulse" />
                        REC {elapsedLabel}
                      </div>
                    ) : (
                      <span />
                    )}
                    {progressLabel && (
                      <span className="text-[11px] font-semibold text-kiosk-text-muted text-right truncate">
                        Tiến độ thu nhận khung ảnh:{" "}
                        <span className="text-kiosk-text font-bold">{progressLabel}</span>
                      </span>
                    )}
                  </div>

                  {isWorkflowStarted && failedRecordingCount > 0 && (
                    <div className="px-1 text-[11px] font-semibold text-kiosk-danger">
                      ⚠ {failedRecordingCount} camera không quay được video (ảnh chụp không bị ảnh hưởng)
                    </div>
                  )}

                  {/* Vertical checklist — same steps/currentStepIndex data as the header's horizontal pill, just restyled for the sidebar. */}
                  <Card variant="panel" className="p-3 flex-1 min-h-0 overflow-y-auto">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-kiosk-text-muted mb-2">
                      Danh sách tư thế
                    </div>
                    <StepProgress
                      steps={steps}
                      currentStepIndex={guidance.currentStepIndex}
                      orientation="vertical"
                    />
                  </Card>
                </>
              ) : (
                <>
                  <PhotoQualityChecklist items={qualityChecklistItems} />

                  <div className="mt-auto pt-1 flex flex-col gap-2">
                    <Button
                      variant="primary"
                      size="xl"
                      className="w-full uppercase tracking-wide"
                      disabled={!canManualCaptureFromSidebar || !isFaceReadyForCapture}
                      onClick={canManualCaptureFromSidebar ? onShutterCapture : undefined}
                    >
                      Xác nhận chuẩn bị & chụp trong 3 giây
                    </Button>
                    {!canManualCaptureFromSidebar && (
                      <p className="text-center text-[11px] text-kiosk-text-muted">
                        {displayInstruction}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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

                        {/* Digital zoom, so it's visible whether the auto-zoom fallback is actually engaging */}
                        {!!zoomScale && zoomScale > 1.001 && (
                          <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/40">
                            <span className="text-slate-400 font-bold">Zoom số:</span>
                            <span className="font-mono font-bold text-amber-400">
                              {zoomScale.toFixed(2)}x
                            </span>
                          </div>
                        )}

                        {/* Shoulder-level check — separate model, separate failure mode from face quality below */}
                        {faceState.posture && (
                          <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/40">
                            <span className="text-slate-400 font-bold">Vai:</span>
                            <span className="font-mono font-bold text-blue-400">
                              {faceState.posture.shoulderRoll !== null
                                ? `${faceState.posture.shoulderRoll}°`
                                : "chưa thấy"}
                            </span>
                          </div>
                        )}

                        {/* Biometric Quality Check */}
                        {faceState.quality && (() => {
                          // Single source of truth for "why can't this capture
                          // right now": the engine's own step-aware evaluation
                          // (WorkflowEngine -> StepEvaluator -> GuidanceEngine
                          // -> guidance.hints), which already covers presence,
                          // pose-vs-this-step's-target, quality, and posture
                          // (posture only when the active step checks it — see
                          // CaptureStep.postureCheck; LEFT/RIGHT opt out since
                          // turning legitimately rotates the shoulder line).
                          //
                          // This badge used to re-derive its own narrower list
                          // from faceState.quality/posture directly, which
                          // never looked at pose at all — turning the wrong
                          // way (or not far enough) during LEFT/RIGHT still
                          // showed ĐẠT CHUẨN, because a pose mismatch was
                          // invisible to this panel even though it was the
                          // actual, correct reason capture never fired.
                          const reasonHints = guidance.hints ?? [];
                          const accepted = reasonHints.length === 0;

                          return (
                            <div className="space-y-1.5 pt-2 border-t border-slate-800/40">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-400 font-bold">
                                  Chất lượng sinh trắc:
                                </span>
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded-full font-bold text-[10px] border",
                                    accepted
                                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                      : "bg-rose-500/20 text-rose-400 border-rose-500/40",
                                  )}
                                >
                                  {accepted ? "ĐẠT CHUẨN ✓" : "KHÔNG ĐẠT ✕"}
                                </span>
                              </div>

                              {reasonHints.length > 0 && (
                                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] space-y-0.5">
                                  <span className="font-bold block">
                                    Lý do chưa đạt:
                                  </span>
                                  <ul className="list-disc list-inside">
                                    {reasonHints.map((hint, i) => (
                                      // QUALITY_REASON_LABEL has curated short labels for
                                      // the quality/posture codes; guidance's own message
                                      // (already Vietnamese) covers the pose/presence codes
                                      // it doesn't have an entry for.
                                      <li key={i}>{QUALITY_REASON_LABEL[hint.code] ?? hint.message}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })()}
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
                              {captureModeFromCampaign
                                ? "Theo cấu hình campaign"
                                : "Chọn cách thức chụp tự động hoặc thủ công"}
                            </span>
                          </div>
                        </div>

                        {/*
                          Segmented Mode Picker — disabled while the campaign
                          dictates the mode (captureModeFromCampaign), not just
                          hinted: a local override here used to silently
                          desync from what setCaptureTriggerConfig actually
                          told the engine (see FaceCaptureApp's
                          effectiveTriggerConfig doc comment), so the simplest
                          fix that can't drift again is to not offer the
                          choice at all for this session.
                        */}
                        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/40 border border-slate-800/60">
                          {(["AUTO", "MANUAL", "OFF"] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => handleCaptureModeChange(m)}
                              disabled={captureModeFromCampaign}
                              title={captureModeFromCampaign ? "Theo cấu hình campaign" : undefined}
                              className={cn(
                                "py-1.5 rounded-lg text-xs font-black transition-all active:scale-95 text-center",
                                captureModeFromCampaign
                                  ? "cursor-not-allowed opacity-50"
                                  : "cursor-pointer",
                                captureMode === m
                                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30 border border-violet-500"
                                  : theme === "dark"
                                    ? "text-slate-400 hover:text-slate-200"
                                    : "text-slate-600 hover:text-slate-900",
                              )}
                            >
                              {TRIGGER_MODE_LABEL[m]}
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

          {/*
            Bottom-left "ĐÃ CHỤP · ĐANG CHỤP" panel — plan item 13,
            2026-09-17. Always rendered (no `isFullscreen`/
            `showTelemetryDrawer` gate, unlike every earlier placement of
            this same `CapturedListPanel` — see this file's other doc
            comments on why those were effectively invisible on a real
            kiosk), collapsible to a small pill via `capturedPanelCollapsed`
            so it doesn't have to permanently sit over the live preview.
          */}
          <div
            className={cn(
              "absolute left-2 sm:left-4 bottom-2 z-40 flex flex-col select-none",
              capturedPanelCollapsed ? "w-auto" : "w-72 max-w-[calc(100vw-2rem)] max-h-[50vh]",
            )}
          >
            {capturedPanelCollapsed ? (
              <button
                onClick={() => setCapturedPanelCollapsed(false)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-full border shadow-xl backdrop-blur-3xl text-xs font-bold cursor-pointer transition-colors",
                  theme === "dark"
                    ? "bg-slate-900/95 border-slate-800 text-slate-100"
                    : "bg-white/95 border-slate-200 text-slate-900",
                )}
              >
                <Images className="w-3.5 h-3.5" />
                Đã chụp{capturedList?.recent?.length ? ` (${capturedList.recent.length})` : ""}
              </button>
            ) : (
              <div className="relative flex flex-col min-h-0">
                <button
                  onClick={() => setCapturedPanelCollapsed(true)}
                  aria-label="Thu gọn danh sách đã chụp"
                  title="Thu gọn"
                  className={cn(
                    "absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold cursor-pointer shadow-lg transition-colors",
                    theme === "dark"
                      ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                      : "bg-white border-slate-200 text-slate-500 hover:text-slate-900",
                  )}
                >
                  ✕
                </button>
                <CapturedListPanel
                  current={capturedList?.current ?? null}
                  recent={capturedList?.recent ?? []}
                  onOpenSession={capturedList?.onOpenSession ?? (() => {})}
                  theme={theme}
                  className="max-h-[50vh]"
                />
              </div>
            )}
          </div>
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
                    Camera sẵn sàng. Bấm Bắt đầu chụp {steps.length} bước.
                  </span>
                </div>
                <button
                  onClick={onStartWorkflow}
                  disabled={framesBlocked}
                  title={framesBlocked ? "Chưa đủ camera cho chế độ chụp đồng thời" : undefined}
                  className={cn(
                    "px-5 py-1.5 rounded-full text-white font-bold text-xs shadow-md shadow-blue-500/30 active:scale-95 transition-all flex items-center gap-1.5 shrink-0",
                    framesBlocked
                      ? "bg-slate-600 opacity-60 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-500 cursor-pointer",
                  )}
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
                      displayStatus === "READY" ||
                        displayStatus === "CAPTURING"
                        ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30"
                        : "bg-blue-500/20 text-blue-600 border-blue-500/30",
                    )}
                  >
                    {displayStatus}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold truncate",
                      theme === "dark" ? "text-slate-100" : "text-slate-900",
                    )}
                  >
                    {displayInstruction}
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
