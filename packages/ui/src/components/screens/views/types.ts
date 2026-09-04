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

export type CameraScale = "compact" | "standard" | "large";

/** One tile's worth of data for the multi-frame simultaneous capture grid. */
export interface MultiFrameViewFrame {
  stepId: string;
  label: string;
  roleLabel: string;
  deviceLabel: string | null;
  stream: MediaStream | null;
  status: "PENDING" | "CURRENT" | "COMPLETED" | "FAILED" | "MISSING";
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
}
