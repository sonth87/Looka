import React, { useState } from 'react';
import { UserCheck, Scan, Minus, Plus, Maximize, Minimize } from 'lucide-react';
import { CameraDevice, FaceState, AttendanceResult } from '@face/core';
import { CameraPreview } from '../camera/CameraPreview.js';
import { CameraSelector } from '../camera/CameraSelector.js';
import { FaceOverlay } from '../face/FaceOverlay.js';
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


export interface KioskAttendanceScreenProps {
  stream: MediaStream | null;
  faceState?: FaceState | null;
  attendanceResult?: AttendanceResult | null;
  personLabel?: string;
  devices: CameraDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  cameraFps?: number;
  cvFps?: number;
  showDebugPanel?: boolean;
  mode?: 'simulation' | 'live';
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onSwitchMode?: () => void;
  className?: string;
}

export type CameraScale = 'compact' | 'standard' | 'large';

export const KioskAttendanceScreen: React.FC<KioskAttendanceScreenProps> = ({
  stream,
  faceState,
  attendanceResult,
  personLabel,
  devices,
  selectedDeviceId,
  onSelectDevice,
  cameraFps = 0,
  cvFps = 0,
  showDebugPanel = true,
  mode = 'live',
  theme = 'dark',
  onToggleTheme,
  onSwitchMode,
  className,
}) => {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initialSettings = getSettings();

  const [cameraScale, setCameraScale] = useState<CameraScale>(initialSettings.cameraScale || 'standard');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(initialSettings.isFullscreen ?? false);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(initialSettings.overlayVisible ?? true);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(initialSettings.overlayOpacity ?? 1.0);
  const [showLandmarks, setShowLandmarks] = useState<boolean>(initialSettings.showLandmarks ?? false);
  const [landmarkSize, setLandmarkSize] = useState<number>(initialSettings.landmarkSize ?? 1.5);

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

  const hasRecognized = !!personLabel;

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
        'relative min-h-screen flex flex-col items-center justify-between p-2 sm:p-5 overflow-x-hidden select-none transition-colors duration-300',
        theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900',
        className
      )}
    >
      {/* ── Fixed Top-Right Theme Toggle (Hidden in Fullscreen) ── */}
      {!isFullscreen && onToggleTheme && (
        <div className="fixed top-2 sm:top-3.5 right-2 sm:right-4 z-[60]">
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      )}

      {/* ── Top Header (Hidden in Fullscreen) ── */}
      {!isFullscreen && (
        <header className="w-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 pt-1 pb-1">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500 font-black text-xs sm:text-sm shrink-0 shadow-md">
              K
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-bold tracking-tight leading-tight">Kiosk Chấm Công Tự Động</h1>
              <p className={cn('text-[10px] sm:text-[11px] leading-tight hidden sm:block', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>
                Offline-first Real-time Face Recognition
              </p>
            </div>
          </div>

          {onSwitchMode && (
            <div className="pr-9 sm:pr-12">
              <button
                onClick={onSwitchMode}
                className={cn(
                  'px-2.5 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs border rounded-xl font-semibold transition-all cursor-pointer shadow-sm',
                  theme === 'dark'
                    ? 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300'
                )}
              >
                Mode Đăng Ký
              </button>
            </div>
          )}
        </header>
      )}

      {/* ── Main Content Area ── */}
      <main
        className={cn(
          'w-full flex-1 flex flex-col items-center justify-center z-10',
          isFullscreen
            ? 'fixed inset-0 p-0 m-0 z-40 bg-black'
            : isMobile
            ? 'my-0 px-0 h-[68vh] flex-1'
            : 'my-2 sm:my-3 max-w-2xl px-1 sm:px-0'
        )}
      >
        <div
          className={cn(
            'relative transition-all duration-300',
            isFullscreen
              ? 'w-full h-full rounded-none'
              : isMobile
              ? 'w-full h-full flex-1'
              : cn('w-full', cameraWidthClass)
          )}
        >
          {/* ── 3 Control Buttons: "-", "+", Fullscreen (Hidden on Mobile) ── */}
          <TooltipProvider>
            <div className="hidden sm:flex absolute top-2.5 sm:top-3 right-2.5 sm:right-3 z-50 items-center gap-0.5 sm:gap-1 bg-slate-950/75 backdrop-blur-md p-0.5 sm:p-1 rounded-xl border border-slate-800/80 shadow-2xl">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={decreaseScale}
                    disabled={cameraScale === 'compact' || isFullscreen}
                    className="p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
                    disabled={cameraScale === 'large' || isFullscreen}
                    className="p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
                      'p-1 sm:p-1.5 rounded-lg text-xs transition-colors cursor-pointer',
                      isFullscreen
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
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
            aspectRatio={isFullscreen || isMobile ? 'auto' : '16/9'}
            className={cn(
              'w-full overflow-hidden transition-all border-0 shadow-none bg-transparent',
              isFullscreen
                ? 'w-screen h-screen rounded-none bg-black'
                : isMobile
                ? 'w-full h-full rounded-2xl'
                : 'rounded-2xl sm:rounded-3xl'
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
                variant="recognition"
                personLabel={personLabel}
              />
            )}

            {/* Scanning pulse overlay */}
            {faceState?.detected && !hasRecognized && (
              <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-4 sm:pb-6 z-10">
                <div
                  style={{
                    backdropFilter: 'url(#liquid-glass-refraction) blur(16px) saturate(180%)',
                    WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(16px) saturate(180%)',
                  }}
                  className={cn(
                    'flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border text-[11px] sm:text-xs font-bold shadow-2xl transition-all',
                    theme === 'dark' || isFullscreen
                      ? 'bg-slate-950/40 border-white/30 text-slate-100 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)]'
                      : 'bg-white/50 border-white/70 text-slate-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)]'
                  )}
                >
                  <Scan className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-blue-400" style={{ animationDuration: '2s' }} />
                  Đang nhận diện...
                </div>
              </div>
            )}

            {/* Status Overlay Banner */}
            {attendanceResult && (
              <div
                className={cn(
                  'absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-2xl backdrop-blur-md shadow-2xl border flex items-center gap-2.5 sm:gap-3 transition-all duration-300 z-20 whitespace-nowrap max-w-[90%]',
                  attendanceResult.status === 'RECORDED' &&
                    'bg-emerald-950/85 border-emerald-500/50 text-emerald-300',
                  attendanceResult.status === 'ALREADY_RECORDED' &&
                    'bg-amber-950/85 border-amber-500/50 text-amber-300',
                  attendanceResult.status === 'REJECTED' &&
                    'bg-rose-950/85 border-rose-500/50 text-rose-300'
                )}
              >
                <div className="text-xl sm:text-2xl">
                  {attendanceResult.status === 'RECORDED' && <UserCheck className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" />}
                  {attendanceResult.status === 'ALREADY_RECORDED' && '⚠️'}
                  {attendanceResult.status === 'REJECTED' && '❓'}
                </div>
                <div>
                  <div className="text-xs sm:text-sm font-bold">
                    {attendanceResult.status === 'RECORDED' && 'Điểm danh thành công'}
                    {attendanceResult.status === 'ALREADY_RECORDED' && 'Đã điểm danh gần đây'}
                    {attendanceResult.status === 'REJECTED' && 'Khuôn mặt chưa đăng ký'}
                  </div>
                  <div className="text-[10px] sm:text-xs opacity-75">{attendanceResult.message}</div>
                </div>
              </div>
            )}

            {/* No stream placeholder */}
            {!stream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-transparent">
                <Scan className={cn('w-12 h-12 sm:w-14 sm:h-14 opacity-30', theme === 'dark' || isFullscreen ? 'text-emerald-400' : 'text-emerald-600')} />
                <p className={cn('text-xs sm:text-sm font-semibold tracking-wide', theme === 'dark' || isFullscreen ? 'text-slate-400' : 'text-slate-600')}>
                  Camera chưa kết nối
                </p>
              </div>
            )}
          </CameraPreview>
        </div>
      </main>

      {/* Footer (Hidden in Fullscreen) */}
      {!isFullscreen && (
        <footer className={cn('w-full max-w-lg text-center text-[11px] sm:text-xs z-10 my-1 px-3', theme === 'dark' ? 'text-slate-500' : 'text-slate-400')}>
          Vui lòng đứng trước camera để thực hiện điểm danh tự động
        </footer>
      )}

      {/* Fixed Bottom-Right Camera Selector */}
      <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 max-w-[calc(100vw-24px)]">
        <CameraSelector
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={onSelectDevice}
          className="w-36 sm:w-48 shadow-xl"
        />
      </div>

      {/* Draggable CV Debug Panel & Overlay Config Panel */}
      {showDebugPanel && (
        <>
          <DebugPanel
            faceState={faceState}
            fps={cameraFps}
            cvFps={cvFps}
            theme={theme}
            isFullscreen={isFullscreen}
            defaultPosition={{ x: 20, y: 75 }}
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
              theme={theme}
              isFullscreen={isFullscreen}
              defaultPosition={{ x: 20, y: 360 }}
            />
          )}
        </>
      )}
    </div>
  );
};
