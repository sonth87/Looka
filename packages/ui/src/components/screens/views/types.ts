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

export type CameraScale = "compact" | "standard" | "large";

export interface SharedCaptureViewProps {
  stream: MediaStream | null;
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
  hasCompletedSession?: boolean;
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
}
