import React from "react";
import {
  CameraDevice,
  CaptureSensitivity,
  CaptureTriggerMode,
  FaceState,
  GestureState,
  GestureType,
  GuidanceState,
} from "@face/core";
import { StepItem } from "../../workflow/StepProgress.js";
import { RectBounds } from "../../face/FlyingThumbnail.js";
import { FramePreflight } from "../../../lib/multiFrame.js";
import { StudentSubjectInfo } from "../../../lib/CaptureSink.js";
import { CapturedListCurrent, CapturedListRecentEntry } from "../../workflow/CapturedListPanel.js";

export type CameraScale = "compact" | "standard" | "large";

/** One tile's worth of data for the multi-frame simultaneous capture grid. */
export interface MultiFrameViewFrame {
  stepId: string;
  label: string;
  roleLabel: string;
  deviceLabel: string | null;
  stream: MediaStream | null;
  /**
   * 'UNASSIGNED': a live stream is showing (e.g. the CENTER/FRONT tile
   * mirroring the main preview) but no camera device is actually mapped or
   * connected to this role yet. Distinct from 'MISSING' (no stream at all) so
   * the badge doesn't read as a broken camera when the video is clearly live.
   * 'READY': a side (non-CENTER) frame whose camera has actually rendered a
   * real frame (see `allSideFramesReady` in lib/multiFrame.ts) but has not
   * yet been captured — 2026-09-05 fix distinguishing this from 'PENDING'
   * (stream attached but not yet confirmed playing), the state a black-frame
   * side capture slipped through in.
   */
  status: "PENDING" | "READY" | "CURRENT" | "COMPLETED" | "FAILED" | "MISSING" | "UNASSIGNED";
  imagePath?: string | null;
}

/**
 * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture) —
 * present only while the campaign's `simultaneousCapture` flag is on AND the
 * kiosk is in live mode; `undefined` otherwise, which keeps the sequential
 * single-camera path byte-for-byte unchanged in both views.
 */
export interface MultiFrameViewProps {
  frames: MultiFrameViewFrame[];
  /** Non-null once a preflight has run; `!blocked.ok` means the session must not start. */
  blocked: FramePreflight | null;
  onOpenCameraSetup: () => void;
  onRecheck: () => void;
  /**
   * 2026-09-05 black-frame fix: whether every side (non-CENTER) frame has
   * actually rendered a real video frame yet — see `allSideFramesReady` in
   * lib/multiFrame.ts. The shutter (OFF mode) must stay disabled while this
   * is false, on top of its existing face-quality gate, so a not-yet-ready
   * side camera can never have its black initial frame captured and stored.
   */
  allSideFramesReady: boolean;
  /**
   * The first not-yet-ready side frame's camera-role label (Vietnamese, see
   * CAMERA_ROLE_LABELS_VI), for the "Đang chờ camera <role>…" shutter hint.
   * `null` once `allSideFramesReady` is true.
   */
  notReadyRoleLabel: string | null;
}

export interface SharedCaptureViewProps {
  stream: MediaStream | null;
  /** Digital zoom for the preview when the camera has no hardware zoom. See CameraPreview. */
  zoomScale?: number;
  /** Digital zoom's crop centre, as a ratio of the frame (0.5, 0.5 = middle). See CameraPreview. */
  zoomOrigin?: { x: number; y: number };
  faceState?: FaceState | null;
  guidance: GuidanceState;
  steps: StepItem[];
  devices: CameraDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  cameraFps: number;
  cvFps: number;
  stabilityProgress: number;
  countdownValue: number;
  showDebugPanel: boolean;
  mode: "simulation" | "live";
  theme: "dark" | "light";
  onToggleTheme?: () => void;
  modeButton?: React.ReactNode;
  onCancel?: () => void;
  onStartLive?: () => void;
  isCameraLoading?: boolean;
  cameraError?: string | null;
  isWorkflowStarted: boolean;
  onStartWorkflow?: () => void;
  onOpenReview?: () => void;
  /** Whether the session holds at least one photo worth reviewing. */
  hasCapturedImages?: boolean;
  showScreenDebugStats: boolean;
  onToggleShowScreenDebugStats?: (show: boolean) => void;
  className?: string;
  gestureState?: GestureState | null;
  gestureProgress: number;
  onShutterCapture?: () => void;
  cameraScale: CameraScale;
  decreaseScale: () => void;
  increaseScale: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  cameraWidthClass: string;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  overlayVisible: boolean;
  overlayOpacity: number;
  showLandmarks: boolean;
  landmarkSize: number;
  flashTrigger: boolean;
  setFlashTrigger: (trigger: boolean) => void;
  freezeSnapshot: string | null;
  flyingState: {
    imageSrc: string | null;
    startRect: RectBounds | null;
    targetRect: RectBounds | null;
  };
  setFlyingState: (state: any) => void;
  renderTopLeftDebugOverlay: () => React.ReactNode;
  renderFaceDiagnostics: () => React.ReactNode;
  captureMode: CaptureTriggerMode;
  autoHoldMs: number;
  /**
   * True while `captureMode` is dictated by the campaign rather than this
   * machine's own local settings — see FaceCaptureApp's
   * `effectiveTriggerConfig.fromCampaign`. The mode selector (DesktopCaptureView's
   * telemetry drawer, OverlayConfigPanel) shows a "Theo cấu hình campaign"
   * hint and disables itself while this is true, so an operator can no
   * longer pick a mode the WorkflowEngine was never told to honour.
   */
  captureModeFromCampaign?: boolean;
  allowedGestures: GestureType[];
  handleToggleOverlayVisible: () => void;
  handleOpacityChange: (val: number) => void;
  handleToggleLandmarks: () => void;
  handleLandmarkSizeChange: (val: number) => void;
  handleCaptureModeChange: (mode: CaptureTriggerMode) => void;
  handleAutoHoldMsChange: (ms: number) => void;
  handleAllowedGesturesChange: (gestures: GestureType[]) => void;
  activeSensitivity: CaptureSensitivity;
  handleSensitivityChange: (sens: CaptureSensitivity) => void;
  /** See MultiFrameViewProps. Absent (undefined) on the sequential single-camera path. */
  multiFrame?: MultiFrameViewProps;
  /**
   * §3.10 layer 2 ("Trong phiên") — recording channels the byte-liveness
   * monitor in FaceCaptureApp's two recording effects has declared failed
   * (a 3s data gap, one automatic restart attempt, then another 3s gap with
   * still no data — see `packages/ui/src/lib/recordingLiveness.ts`). Keyed
   * by camera id: `selectedDeviceId || 'default'` on the sequential
   * single-stream path, each mapped device id on the multi-channel path.
   * Not yet rendered by DesktopCaptureView/MobileCaptureView — exposed here
   * so a later UI pass can add the "● REC" / failure indicators
   * ui-redesign-plan.md's S5 mockup calls for ("Video CENTER không ghi
   * được — phiên này sẽ phải chụp lại") without this reliability fix
   * waiting on that UI work.
   */
  recordingFailed?: Record<string, boolean>;
  /**
   * ui-redesign-plan.md S5 left zone ("NGƯỜI ĐƯỢC CHỤP") — see
   * `SubjectInfoBadge`. `null`/absent renders nothing (no code entered yet,
   * or this pass's caller has no round-plan/subject data to hand it — see
   * `SubjectInfoBadge`'s own props doc). `round`/`roundCount` come from the
   * §3.1.5 round-planning function (`planCaptureRounds` in
   * `lib/multiFrame.ts`), not yet wired into a live session — see the TODO
   * at FaceCaptureApp.tsx's `runSimultaneousCaptureGate`.
   */
  subjectInfo?: {
    subject: StudentSubjectInfo | null;
    round: number;
    roundCount: number;
    photoCount: number;
    photoTotal: number;
  } | null;
  /**
   * ui-redesign-plan.md S5 right zone ("ĐÃ CHỤP · ĐANG CHỤP") — see
   * `CapturedListPanel`. Absent renders an empty panel; real data (Q19:
   * whole campaign online, this device only offline) is a later
   * integration pass, not this one.
   */
  capturedList?: {
    current: CapturedListCurrent | null;
    recent: CapturedListRecentEntry[];
    onOpenSession: (subjectCode: string) => void;
  };
}
