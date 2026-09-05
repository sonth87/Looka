export { cn } from './lib/utils.js';
export {
  getSettings,
  updateSettings,
  getPanelState,
  updatePanelState,
} from './lib/settingsStore.js';
export type { AppSettings, PanelState } from './lib/settingsStore.js';


// UI Primitives (shadcn)
export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from './components/ui/tooltip.js';

// Camera
export { CameraPreview, CAPTURE_MIRRORED } from './components/camera/CameraPreview.js';
export { CameraSelector } from './components/camera/CameraSelector.js';
export { CameraPermission } from './components/camera/CameraPermission.js';
export { CameraError } from './components/camera/CameraError.js';
export { FrameTile } from './components/camera/FrameTile.js';
export type { FrameTileProps, FrameTileStatus } from './components/camera/FrameTile.js';
export { MultiFrameGrid } from './components/camera/MultiFrameGrid.js';
export type { MultiFrameGridFrame, MultiFrameGridProps } from './components/camera/MultiFrameGrid.js';
export { FramesBlockedPanel } from './components/camera/FramesBlockedPanel.js';
export type { FramesBlockedPanelProps } from './components/camera/FramesBlockedPanel.js';
export { CAMERA_ROLE_LABELS_VI } from './lib/multiFrame.js';

// Face
export { FaceOverlay } from './components/face/FaceOverlay.js';
export { GestureOverlay } from './components/face/GestureOverlay.js';
export type { GestureOverlayProps } from './components/face/GestureOverlay.js';
export { ShutterButton } from './components/face/ShutterButton.js';
export type { ShutterButtonProps } from './components/face/ShutterButton.js';
export { ShutterFlashOverlay } from './components/face/ShutterFlashOverlay.js';
export type { ShutterFlashOverlayProps } from './components/face/ShutterFlashOverlay.js';
export { FlyingThumbnail } from './components/face/FlyingThumbnail.js';
export type { FlyingThumbnailProps, RectBounds } from './components/face/FlyingThumbnail.js';

// Workflow
export { StepProgress } from './components/workflow/StepProgress.js';
export type { StepItem } from './components/workflow/StepProgress.js';
export { GuidanceMessage } from './components/workflow/GuidanceMessage.js';
export { StabilityProgress } from './components/workflow/StabilityProgress.js';
export { CountdownTimer } from './components/workflow/CountdownTimer.js';
export { SessionReviewModal } from './components/workflow/SessionReviewModal.js';

// Debug
export { DebugPanel } from './components/debug/DebugPanel.js';
export { SimulationSliders } from './components/debug/SimulationSliders.js';
export type { SimulationSettings } from './components/debug/SimulationSliders.js';
export { DraggablePanel } from './components/debug/DraggablePanel.js';
export { OverlayConfigPanel } from './components/debug/OverlayConfigPanel.js';

// Theme
export { ThemeToggle } from './components/theme/ThemeToggle.js';
export { LiquidGlassSvgFilter } from './components/theme/LiquidGlassSvgFilter.js';
export { LiquidGlassCard } from './components/theme/LiquidGlassCard.js';
export type { LiquidGlassCardProps } from './components/theme/LiquidGlassCard.js';
export { LookaIcon } from './components/theme/LookaIcon.js';

// Screens
export { GuidedCaptureScreen } from './components/screens/GuidedCaptureScreen.js';
export { KioskAttendanceScreen } from './components/screens/KioskAttendanceScreen.js';
export { KioskAttendanceApp } from './components/screens/KioskAttendanceApp.js';
export { FaceCaptureApp } from './components/screens/FaceCaptureApp.js';

export * from './lib/CaptureSink.js';
