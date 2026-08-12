import React from 'react';
import { Bug, Activity } from 'lucide-react';
import { FaceState } from '@face/core';
import { DraggablePanel } from './DraggablePanel.js';
import { cn } from '../../lib/utils.js';

export interface DebugPanelProps {
  faceState?: FaceState | null;
  fps?: number;
  cvFps?: number;
  theme?: 'dark' | 'light';
  isFullscreen?: boolean;
  className?: string;
  defaultPosition?: { x: number; y: number };
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  faceState,
  fps = 0,
  cvFps = 0,
  theme = 'dark',
  isFullscreen = false,
  className,
  defaultPosition = { x: 30, y: 120 },
}) => {
  const pose = faceState?.pose || { yaw: 0, pitch: 0, roll: 0 };
  const quality = faceState?.quality;

  const presenceColor =
    faceState?.presence === 'SINGLE_FACE'
      ? 'text-emerald-400 bg-emerald-500/20 border-emerald-400/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
      : faceState?.presence === 'MULTIPLE_FACES'
      ? 'text-amber-400 bg-amber-500/20 border-amber-400/40 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
      : 'text-rose-400 bg-rose-500/20 border-rose-400/40 shadow-[0_0_12px_rgba(244,63,94,0.3)]';

  const title = (
    <span className={cn('flex items-center gap-2 font-semibold', theme === 'dark' ? 'text-slate-100' : 'text-slate-900')}>
      <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
      CV Debug Panel
    </span>
  );

  const liquidCardStyle =
    theme === 'dark'
      ? isFullscreen
        ? 'bg-slate-900/20 border border-white/20 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),_inset_0_-1px_1px_rgba(0,0,0,0.5)]'
        : 'bg-slate-900/35 border border-white/15 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),_inset_0_-1px_1px_rgba(0,0,0,0.4)]'
      : isFullscreen
      ? 'bg-white/20 border border-white/60 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),_inset_0_-1px_1px_rgba(0,0,0,0.1)]'
      : 'bg-white/35 border border-white/50 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),_inset_0_-1px_1px_rgba(0,0,0,0.1)]';

  const glassBorderTop =
    theme === 'dark' ? 'border-t border-white/15' : 'border-t border-white/40';

  return (
    <DraggablePanel
      storageKey="face_ui_debug_panel"
      title={title}
      icon={<Bug className="w-5 h-5" />}
      theme={theme}
      isFullscreen={isFullscreen}
      defaultPosition={defaultPosition}
      className={cn('w-72', className)}
    >
      <div className="space-y-3">
        {/* Performance FPS */}
        <div className="grid grid-cols-2 gap-2">
          <div className={cn('p-2.5 rounded-xl border relative overflow-hidden', liquidCardStyle)}>
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />
            <span className={cn('text-[10px] uppercase block font-bold tracking-wide', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>Camera FPS</span>
            <span className="text-base font-bold text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.4)]">{fps}</span>
          </div>
          <div className={cn('p-2.5 rounded-xl border relative overflow-hidden', liquidCardStyle)}>
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-400/40 to-transparent" />
            <span className={cn('text-[10px] uppercase block font-bold tracking-wide', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>CV Engine FPS</span>
            <span className="text-base font-bold text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.4)]">{cvFps}</span>
          </div>
        </div>

        {/* Presence State */}
        <div className="flex items-center justify-between pt-1">
          <span className={cn('text-[11px] font-semibold', theme === 'dark' ? 'text-slate-200' : 'text-slate-700')}>Presence</span>
          <span className={cn('px-3 py-0.5 rounded-full text-[10px] font-bold border backdrop-blur-md transition-all', presenceColor)}>
            {faceState?.presence || 'NO_FACE'}
          </span>
        </div>

        {/* Head Pose */}
        <div className={cn('space-y-1.5 pt-2.5', glassBorderTop)}>
          <span className={cn('text-[10px] uppercase font-bold tracking-wider', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>
            Head Pose (Deg)
          </span>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className={cn('p-2 rounded-xl border relative overflow-hidden', liquidCardStyle)}>
              <div className={cn('text-[9px] font-bold', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>YAW</div>
              <div
                className={cn(
                  'font-bold text-xs mt-0.5',
                  Math.abs(pose.yaw) <= 10
                    ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]'
                    : Math.abs(pose.yaw) <= 35
                    ? 'text-blue-400'
                    : 'text-amber-400'
                )}
              >
                {pose.yaw}°
              </div>
            </div>
            <div className={cn('p-2 rounded-xl border relative overflow-hidden', liquidCardStyle)}>
              <div className={cn('text-[9px] font-bold', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>PITCH</div>
              <div
                className={cn(
                  'font-bold text-xs mt-0.5',
                  Math.abs(pose.pitch) <= 10 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]' : 'text-amber-400'
                )}
              >
                {pose.pitch}°
              </div>
            </div>
            <div className={cn('p-2 rounded-xl border relative overflow-hidden', liquidCardStyle)}>
              <div className={cn('text-[9px] font-bold', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>ROLL</div>
              <div
                className={cn(
                  'font-bold text-xs mt-0.5',
                  Math.abs(pose.roll) <= 10 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]' : 'text-amber-400'
                )}
              >
                {pose.roll}°
              </div>
            </div>
          </div>
        </div>

        {/* Quality Metrics */}
        {quality && (
          <div className={cn('space-y-1.5 pt-2.5', glassBorderTop)}>
            <span className={cn('text-[10px] uppercase font-bold tracking-wider', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>
              Face Quality ({quality.overallScore * 100}%)
            </span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className={cn('flex justify-between px-2.5 py-1 rounded-lg border', liquidCardStyle)}>
                <span className={theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}>Size Ratio:</span>
                <span className="font-semibold">{quality.faceSizeRatio}</span>
              </div>
              <div className={cn('flex justify-between px-2.5 py-1 rounded-lg border', liquidCardStyle)}>
                <span className={theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}>Sharpness:</span>
                <span className="font-semibold">{quality.sharpness}</span>
              </div>
              <div className={cn('flex justify-between px-2.5 py-1 rounded-lg border', liquidCardStyle)}>
                <span className={theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}>Brightness:</span>
                <span className="font-semibold">{quality.brightness}</span>
              </div>
              <div className={cn('flex justify-between px-2.5 py-1 rounded-lg border', liquidCardStyle)}>
                <span className={theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}>Center Offset:</span>
                <span className="font-semibold">
                  {Math.max(quality.centerXOffset, quality.centerYOffset)}
                </span>
              </div>
            </div>

            {quality.reasons.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {quality.reasons.map((r, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 text-[9px] bg-rose-500/20 text-rose-300 rounded-md border border-rose-400/30 font-semibold backdrop-blur-md shadow-sm"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DraggablePanel>
  );
};
