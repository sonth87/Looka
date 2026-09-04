import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils.js';

export type FrameTileStatus = 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED' | 'MISSING';

export interface FrameTileProps {
  /** The step's label — same value shown on the sequential path's step chips (its type, e.g. "LEFT"). */
  label: string;
  /** Vietnamese camera-role badge (see CAMERA_ROLE_LABELS_VI in lib/multiFrame.ts). */
  roleLabel: string;
  deviceLabel: string | null;
  stream: MediaStream | null;
  status: FrameTileStatus;
  imagePath?: string | null;
  theme?: 'dark' | 'light';
  className?: string;
}

const STATUS_LABEL_VI: Record<FrameTileStatus, string> = {
  PENDING: 'Chờ',
  CURRENT: 'Đang chụp',
  COMPLETED: 'Đã chụp',
  FAILED: 'Thất bại',
  MISSING: 'Thiếu camera',
};

/**
 * One tile in the multi-frame simultaneous capture grid — a live preview of
 * one physical camera bound to one workflow step, with a status ring/badge
 * and, once COMPLETED, a frozen thumbnail of what was actually captured.
 *
 * The `<video>` wiring mirrors CameraPreview.tsx exactly (same effect, same
 * `play()` rejection logging) — this file's own history of subtle
 * capture-trigger bugs is why nothing here reaches into the CV/capture
 * pipeline; a tile only ever renders whatever stream it is handed.
 */
export const FrameTile: React.FC<FrameTileProps> = ({
  label,
  roleLabel,
  deviceLabel,
  stream,
  status,
  imagePath,
  theme = 'dark',
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch((err) =>
        console.error(
          `[FrameTile] video.play() failed for ${label}: name=${err?.name} message=${err?.message} readyState=${video.readyState}`
        )
      );
    } else {
      video.srcObject = null;
    }
  }, [stream, label]);

  const ringClass =
    status === 'COMPLETED'
      ? 'ring-emerald-500'
      : status === 'CURRENT'
      ? 'ring-blue-500'
      : status === 'FAILED'
      ? 'ring-rose-500'
      : status === 'MISSING'
      ? 'ring-amber-500'
      : 'ring-slate-700';

  const badgeClass =
    status === 'COMPLETED'
      ? 'bg-emerald-500/90 text-white'
      : status === 'CURRENT'
      ? 'bg-blue-500/90 text-white'
      : status === 'FAILED'
      ? 'bg-rose-500/90 text-white'
      : status === 'MISSING'
      ? 'bg-amber-500/90 text-slate-950'
      : 'bg-slate-700/90 text-slate-200';

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-xl ring-2 transition-colors',
        ringClass,
        theme === 'dark' ? 'bg-slate-950' : 'bg-slate-900',
        className
      )}
      data-frame-step-label={label}
    >
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-1 px-2 py-1 bg-gradient-to-b from-black/70 to-transparent text-[10px] font-semibold text-white">
        <span className="truncate">
          {label} · {roleLabel}
        </span>
        <span className="truncate opacity-80">{deviceLabel ?? 'Chưa gán camera'}</span>
      </div>

      <div
        className={cn(
          'absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase',
          badgeClass
        )}
      >
        {STATUS_LABEL_VI[status]}
      </div>

      {status === 'COMPLETED' && imagePath && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-slate-950/80">
          <img
            src={imagePath}
            alt={label}
            className="max-h-[70%] max-w-[85%] rounded-lg object-cover shadow-lg"
          />
          <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
            Đã chụp
          </span>
        </div>
      )}
    </div>
  );
};
