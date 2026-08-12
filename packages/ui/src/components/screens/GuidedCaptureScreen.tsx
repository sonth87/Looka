import React, { useState } from 'react';
import { Video, Minus, Plus, Maximize, Minimize } from 'lucide-react';
import { CameraDevice, CaptureSensitivity, CaptureTriggerMode, FaceState, GestureState, GestureType, GuidanceState } from '@face/core';
import { CameraPreview } from '../camera/CameraPreview.js';
import { CameraSelector } from '../camera/CameraSelector.js';
import { FaceOverlay } from '../face/FaceOverlay.js';
import { GestureOverlay } from '../face/GestureOverlay.js';
import { ShutterButton } from '../face/ShutterButton.js';
import { ShutterFlashOverlay } from '../face/ShutterFlashOverlay.js';
import { FlyingThumbnail, RectBounds } from '../face/FlyingThumbnail.js';
import { StepProgress, StepItem } from '../workflow/StepProgress.js';
import { GuidanceMessage } from '../workflow/GuidanceMessage.js';
import { StabilityProgress } from '../workflow/StabilityProgress.js';
import { CountdownTimer } from '../workflow/CountdownTimer.js';
import { DebugPanel } from '../debug/DebugPanel.js';
import { OverlayConfigPanel } from '../debug/OverlayConfigPanel.js';
import { ThemeToggle } from '../theme/ThemeToggle.js';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '../ui/tooltip.js';
import { cn } from '../../lib/utils.js';
import { getSettings, updateSettings } from '../../lib/settingsStore.js';


export interface GuidedCaptureScreenProps {
  stream: MediaStream | null;
  faceState?: FaceState | null;
  guidance: GuidanceState;
  steps: StepItem[];
  devices: CameraDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  cameraFps?: number;
  cvFps?: number;
  stabilityProgress?: number;
  countdownValue?: number;
  showDebugPanel?: boolean;
  mode?: 'simulation' | 'live';
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  modeButton?: React.ReactNode;
  onCancel?: () => void;
  className?: string;
  // Capture trigger & sensitivity
  gestureState?: GestureState | null;
  gestureProgress?: number;
  onShutterCapture?: () => void;
  sensitivity?: CaptureSensitivity;
  onSensitivityChange?: (sensitivity: CaptureSensitivity) => void;
  onCaptureModeChange?: (mode: CaptureTriggerMode) => void;
  onAutoHoldMsChange?: (ms: number) => void;
  latestCapturedImage?: { stepId: string; imagePath: string } | null;
}

export type CameraScale = 'compact' | 'standard' | 'large';

export const GuidedCaptureScreen: React.FC<GuidedCaptureScreenProps> = ({
  stream,
  faceState,
  guidance,
  steps,
  devices,
  selectedDeviceId,
  onSelectDevice,
  cameraFps = 0,
  cvFps = 0,
  stabilityProgress = 0,
  countdownValue = 0,
  showDebugPanel = true,
  mode = 'live',
  theme = 'dark',
  onToggleTheme,
  modeButton,
  onCancel,
  className,
  gestureState = null,
  gestureProgress = 0,
  onShutterCapture,
  sensitivity: externalSensitivity,
  onSensitivityChange,
  onCaptureModeChange: externalOnCaptureModeChange,
  onAutoHoldMsChange: externalOnAutoHoldMsChange,
  latestCapturedImage,
}) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [flashTrigger, setFlashTrigger] = useState(false);
  const [freezeSnapshot, setFreezeSnapshot] = useState<string | null>(null);
  const [flyingState, setFlyingState] = useState<{
    imageSrc: string | null;
    startRect: RectBounds | null;
    targetRect: RectBounds | null;
  }>({ imageSrc: null, startRect: null, targetRect: null });

  React.useEffect(() => {
    if (!latestCapturedImage || !latestCapturedImage.imagePath) return;

    setFlashTrigger(true);
    setFreezeSnapshot(latestCapturedImage.imagePath);

    const freezeTimer = setTimeout(() => {
      setFreezeSnapshot(null);
    }, 1050);

    if (viewportRef.current) {
      const vpRect = viewportRef.current.getBoundingClientRect();
      const startRect: RectBounds = {
        x: vpRect.left + vpRect.width * 0.25,
        y: vpRect.top + vpRect.height * 0.2,
        width: vpRect.width * 0.5,
        height: vpRect.height * 0.6,
      };

      const targetEl = document.querySelector(`[data-step-id="${latestCapturedImage.stepId}"]`);
      const targetRect = targetEl ? targetEl.getBoundingClientRect() : null;

      if (targetRect) {
        setFlyingState({
          imageSrc: latestCapturedImage.imagePath,
          startRect,
          targetRect: {
            x: targetRect.left,
            y: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          },
        });
      }
    }

    return () => clearTimeout(freezeTimer);
  }, [latestCapturedImage]);
  const initialSettings = getSettings();

  const [cameraScale, setCameraScale] = useState<CameraScale>(initialSettings.cameraScale || 'standard');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(initialSettings.isFullscreen ?? false);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(initialSettings.overlayVisible ?? true);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(initialSettings.overlayOpacity ?? 1.0);
  const [showLandmarks, setShowLandmarks] = useState<boolean>(initialSettings.showLandmarks ?? false);
  const [captureMode, setCaptureMode] = useState<CaptureTriggerMode>(initialSettings.captureMode || 'AUTO');
  const [autoHoldMs, setAutoHoldMs] = useState<number>(initialSettings.autoHoldMs || 2000);
  const [allowedGestures, setAllowedGestures] = useState<GestureType[]>(initialSettings.allowedGestures || ['VICTORY', 'THUMBS_UP', 'OPEN_PALM']);
  const [sensitivityState, setSensitivityState] = useState<CaptureSensitivity>(initialSettings.sensitivity || 'MEDIUM');
  const [landmarkSize, setLandmarkSize] = useState<number>(initialSettings.landmarkSize || 1.5);

  const activeSensitivity = externalSensitivity || sensitivityState;

  const handleToggleOverlayVisible = (val: boolean) => {
    setOverlayVisible(val);
    updateSettings({ overlayVisible: val });
  };

  const handleOpacityChange = (val: number) => {
    setOverlayOpacity(val);
    updateSettings({ overlayOpacity: val });
  };

  const handleToggleLandmarks = (val: boolean) => {
    setShowLandmarks(val);
    updateSettings({ showLandmarks: val });
  };

  const handleLandmarkSizeChange = (val: number) => {
    setLandmarkSize(val);
    updateSettings({ landmarkSize: val });
  };

  const handleCaptureModeChange = (val: CaptureTriggerMode) => {
    setCaptureMode(val);
    updateSettings({ captureMode: val });
    if (externalOnCaptureModeChange) externalOnCaptureModeChange(val);
  };

  const handleAutoHoldMsChange = (val: number) => {
    setAutoHoldMs(val);
    updateSettings({ autoHoldMs: val });
    if (externalOnAutoHoldMsChange) externalOnAutoHoldMsChange(val);
  };

  const handleAllowedGesturesChange = (val: GestureType[]) => {
    setAllowedGestures(val);
    updateSettings({ allowedGestures: val });
  };

  const handleSensitivityChange = (val: CaptureSensitivity) => {
    setSensitivityState(val);
    updateSettings({ sensitivity: val });
    if (onSensitivityChange) onSensitivityChange(val);
  };

  const decreaseScale = () => {
    setCameraScale((prev) => {
      const next = prev === 'large' ? 'standard' : 'compact';
      updateSettings({ cameraScale: next });
      return next;
    });
  };

  const increaseScale = () => {
    setCameraScale((prev) => {
      const next = prev === 'compact' ? 'standard' : 'large';
      updateSettings({ cameraScale: next });
      return next;
    });
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => {
      const next = !prev;
      updateSettings({ isFullscreen: next });
      return next;
    });
  };

  const cameraWidthClass =
    cameraScale === 'compact'
      ? 'max-w-md'
      : cameraScale === 'large'
      ? 'max-w-4xl'
      : 'max-w-2xl';

  return (
    <div
      className={cn(
        'relative min-h-screen flex flex-col items-center justify-between p-3 md:p-5 overflow-x-hidden select-none transition-colors duration-300',
        theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900',
        className
      )}
    >
      {/* ── Top Theme Toggle (Hidden in Fullscreen mode) ── */}
      {!isFullscreen && onToggleTheme && (
        <div className="fixed top-3.5 right-4 z-[60]">
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      )}

      {/* ── Top Header Bar (Hidden in Fullscreen mode) ── */}
      {!isFullscreen && (
        <header className="w-full px-6 flex items-center justify-between gap-3 pt-1 pb-1">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500 font-black text-sm shrink-0 shadow-md">
              FP
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight leading-tight">Guided Face Capture</h1>
              <p className={cn('text-[11px] leading-tight', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>
                Hệ thống hướng dẫn chụp ảnh tự động
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pr-12">
            {modeButton}
          </div>
        </header>
      )}

      {/* ── Steps Line (Hidden in Fullscreen mode) ── */}
      {!isFullscreen && (
        <div className="w-full max-w-lg my-1">
          <StepProgress
            steps={steps}
            currentStepIndex={guidance.currentStepIndex}
            theme={theme}
          />
        </div>
      )}

      {/* ── Main Content: Camera Display ── */}
      <main
        className={cn(
          'w-full flex-1 flex flex-col items-center justify-center z-10',
          isFullscreen ? 'fixed inset-0 p-0 m-0 z-40 bg-black' : 'my-2'
        )}
      >
        <div
          ref={viewportRef}
          className={cn(
            'relative transition-all duration-300',
            isFullscreen ? 'w-full h-full rounded-none' : cn('w-full', cameraWidthClass)
          )}
        >
          {/* ── 3 Control Buttons: "-" (Decrease), "+" (Increase), Fullscreen (Maximize/Minimize) ── */}
          <TooltipProvider>
            <div className="absolute top-3 right-3 z-50 flex items-center gap-1 bg-slate-950/75 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-2xl">
              {/* "-" Decrease size button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={decreaseScale}
                    disabled={cameraScale === 'compact' || isFullscreen}
                    className={cn(
                      'p-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                      theme === 'dark'
                        ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  Giảm kích thước camera (-)
                </TooltipContent>
              </Tooltip>

              {/* "+" Increase size button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={increaseScale}
                    disabled={cameraScale === 'large' || isFullscreen}
                    className={cn(
                      'p-1.5 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                      theme === 'dark'
                        ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  Tăng kích thước camera (+)
                </TooltipContent>
              </Tooltip>

              {/* Fullscreen button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleFullscreen}
                    className={cn(
                      'p-1.5 rounded-lg text-xs transition-colors cursor-pointer',
                      isFullscreen
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" theme="dark">
                  {isFullscreen ? 'Thoát Toàn màn hình' : 'Toàn màn hình (Fullscreen)'}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Camera Preview */}
          <CameraPreview
            stream={stream}
            aspectRatio={isFullscreen ? 'auto' : '16/9'}
            className={cn(
              'w-full shadow-2xl overflow-hidden transition-all',
              isFullscreen
                ? 'w-screen h-screen rounded-none border-none bg-black'
                : cn(
                    'rounded-3xl',
                    theme === 'dark' ? 'border border-slate-800' : 'border border-slate-200 shadow-slate-300/50'
                  )
            )}
          >
            {((mode === 'live' && stream) || mode === 'simulation') && (
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
            <ShutterFlashOverlay trigger={flashTrigger} onFlashComplete={() => setFlashTrigger(false)} />
            <FlyingThumbnail
              imageSrc={flyingState.imageSrc}
              startRect={flyingState.startRect}
              targetRect={flyingState.targetRect}
              onAnimationEnd={() => setFlyingState({ imageSrc: null, startRect: null, targetRect: null })}
            />

            {/* Gesture Overlay (MANUAL mode) */}
            {mode === 'live' && captureMode === 'MANUAL' && (
              <GestureOverlay
                gestureState={gestureState}
                gestureProgress={gestureProgress}
                faceReady={faceState?.detected ?? false}
              />
            )}

            {/* Shutter Button (OFF mode) */}
            {mode === 'live' && captureMode === 'OFF' && onShutterCapture && (
              <ShutterButton
                enabled={faceState?.detected ?? false}
                onCapture={onShutterCapture}
              />
            )}

            {/* Stability progress bar (AUTO mode) */}
            {stabilityProgress > 0 && captureMode === 'AUTO' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-56 z-20">
                <StabilityProgress progress={stabilityProgress} text="Giữ nguyên tư thế..." />
              </div>
            )}

            {/* In Fullscreen mode: StepProgress renders overlayed on top of camera at top center */}
            {isFullscreen && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4 pointer-events-auto">
                <StepProgress
                  steps={steps}
                  currentStepIndex={guidance.currentStepIndex}
                  theme="dark"
                />
              </div>
            )}

            {/* In Fullscreen mode: GuidanceMessage renders overlayed on top of camera at bottom center */}
            {isFullscreen && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4 pointer-events-auto">
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

            {/* No-stream placeholder */}
            {!stream && (
              <div
                className={cn(
                  'absolute inset-0 flex flex-col items-center justify-center gap-3',
                  theme === 'dark' || isFullscreen ? 'bg-slate-900/90' : 'bg-slate-200/90'
                )}
              >
                <Video className={cn('w-14 h-14 opacity-25', theme === 'dark' || isFullscreen ? 'text-slate-400' : 'text-slate-600')} />
                <p className={cn('text-sm font-medium', theme === 'dark' || isFullscreen ? 'text-slate-400' : 'text-slate-600')}>
                  Camera chưa kết nối
                </p>
                <p className={cn('text-xs', theme === 'dark' || isFullscreen ? 'text-slate-500' : 'text-slate-400')}>
                  Chọn chế độ Giả lập hoặc kết nối Live Camera
                </p>
              </div>
            )}
          </CameraPreview>
        </div>
      </main>

      {/* ── Guidance Message + Cancel (Standard mode only) ── */}
      {!isFullscreen && (
        <footer className="w-full max-w-xl space-y-2 z-10 my-1">
          <GuidanceMessage guidance={guidance} theme={theme} />

          {onCancel && (
            <div className="flex justify-center pt-1">
              <button
                onClick={onCancel}
                className={cn(
                  'text-xs underline transition-colors cursor-pointer',
                  theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'
                )}
              >
                Hủy bỏ quy trình
              </button>
            </div>
          )}
        </footer>
      )}

      {/* ── Fixed Bottom-Right: Camera Selector ── */}
      <div className="fixed bottom-4 right-4 z-40">
        <CameraSelector
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={onSelectDevice}
          className="w-48 shadow-xl"
        />
      </div>

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

          {mode === 'live' && (
            <OverlayConfigPanel
              visible={overlayVisible}
              onToggleVisible={handleToggleOverlayVisible}
              opacity={overlayOpacity}
              onOpacityChange={handleOpacityChange}
              showLandmarks={showLandmarks}
              onToggleLandmarks={handleToggleLandmarks}
              landmarkSize={landmarkSize}
              onLandmarkSizeChange={handleLandmarkSizeChange}
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
