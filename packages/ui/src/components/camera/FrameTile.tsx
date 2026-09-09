import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * 'READY': a side frame (non-CENTER) whose camera has actually rendered a
 * real video frame — not just "has a stream attached" — but has not yet
 * been captured. Distinct from 'PENDING', which now means "not yet
 * confirmed playing" (2026-09-05 field bug: a tile read as ready-looking
 * "Chờ"/generic-pending while its camera was still negotiating with the OS
 * driver, and the shutter fired a black frame from it — see
 * `snapshotVideoFrame`/`allSideFramesReady` in lib/multiFrame.ts). CENTER's
 * own tile never needs this state — its readiness is already covered by the
 * normal face-quality gate — so it stays 'PENDING' until captured.
 */
export type FrameTileStatus = 'PENDING' | 'READY' | 'CURRENT' | 'COMPLETED' | 'FAILED' | 'MISSING' | 'UNASSIGNED';

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
  /**
   * Whether this tile is flipped horizontally to match a mirrored capture.
   * Default true: every tile here is a live preview for self-positioning
   * during simultaneous capture, same as the main `CameraPreview` (product
   * decision 2026-09-05 — mirror the preview). The saved still (shown once
   * COMPLETED) is display-mirrored too, so the frozen thumbnail matches the
   * live preview the subject just posed in — the underlying file stays the
   * raw, unmirrored sensor image (BrowserCameraService.mirrorStills is never
   * touched by this).
   */
  mirrored?: boolean;
  /**
   * Visual scale for this tile. `'default'` (the kiosk's own multi-frame
   * strip in `DesktopCaptureView.tsx`): unchanged from before — small
   * label/badge text, a fixed 16:9 `aspect-video` box, and the captured
   * photo shown as a centered thumbnail over a dimmed backdrop. `'large'`
   * (the CB Help extended-display window): bigger label/role text and
   * status badge, and no fixed aspect ratio — the tile stretches to fill
   * whatever box its parent gives it (an equal-width, full-height column
   * per frame — product decision 2026-09-05, fourth pass: "để thành các
   * thanh dọc, grid chia đều cho các khung"), with both the live video and
   * the captured photo covering that box edge-to-edge via `object-cover`
   * instead of a shrunk centered thumbnail — cropping a 16:9 feed's sides
   * into a tall column is expected and fine.
   */
  size?: 'default' | 'large';
}

const STATUS_LABEL_VI: Record<FrameTileStatus, string> = {
  PENDING: 'Chờ',
  READY: 'Sẵn sàng',
  CURRENT: 'Đang chụp',
  COMPLETED: 'Đã chụp',
  FAILED: 'Thất bại',
  MISSING: 'Thiếu camera',
  UNASSIGNED: 'Chưa gán vai trò',
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
  mirrored = true,
  size = 'default',
}) => {
  const isLarge = size === 'large';
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
      : status === 'MISSING' || status === 'UNASSIGNED'
      ? 'ring-amber-500'
      : status === 'READY'
      ? 'ring-emerald-700'
      : 'ring-slate-700';

  const badgeClass =
    status === 'COMPLETED'
      ? 'bg-emerald-500/90 text-white'
      : status === 'CURRENT'
      ? 'bg-blue-500/90 text-white'
      : status === 'FAILED'
      ? 'bg-rose-500/90 text-white'
      : status === 'MISSING' || status === 'UNASSIGNED'
      ? 'bg-amber-500/90 text-slate-950'
      : status === 'READY'
      ? 'bg-emerald-700/90 text-white'
      : 'bg-slate-700/90 text-slate-200';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl ring-2 transition-colors',
        !isLarge && 'aspect-video',
        ringClass,
        theme === 'dark' ? 'bg-slate-950' : 'bg-slate-900',
        className
      )}
      data-frame-step-label={label}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn('w-full h-full object-cover', mirrored && 'scale-x-[-1]')}
      />

      <div
        className={cn(
          'absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-1 bg-gradient-to-b from-black/70 to-transparent font-semibold text-white',
          isLarge ? 'px-4 py-2 text-base sm:text-lg gap-3' : 'px-2 py-1 text-[10px]'
        )}
      >
        <span className="truncate">
          {label} · {roleLabel}
        </span>
        <span className="truncate opacity-80">{deviceLabel ?? 'Chưa gán camera'}</span>
      </div>

      <div
        className={cn(
          'absolute z-10 rounded-full font-bold uppercase',
          isLarge ? 'top-2 right-2 px-3 py-1 text-sm sm:text-base' : 'top-1 right-1 px-1.5 py-0.5 text-[9px]',
          badgeClass
        )}
      >
        {STATUS_LABEL_VI[status]}
      </div>

      {/*
        Item 12b (2026-09-09): generalized from `status === 'COMPLETED'`
        alone so a caller can show a still in place of a live stream this
        tile isn't holding one for — CB Help's CENTER tile does exactly this
        (a periodic preview snapshot pushed over IPC, see
        `CbHelpFrames.tsx`), while every existing caller (this tile's
        COMPLETED thumbnail, everywhere else) is unaffected: none of them
        ever pass `imagePath` together with a non-COMPLETED status AND a live
        `stream` at the same time.
      */}
      {imagePath && (status === 'COMPLETED' || !stream) && (
        isLarge ? (
          // Fill the tile edge-to-edge, same footprint as the live video,
          // so the frozen shot reads just as large from a distance — the
          // top-left/top-right badges above stay legible since they sit at
          // a higher z-index than this plain (non-dimmed) image.
          <img
            src={imagePath}
            alt={label}
            className={cn('absolute inset-0 w-full h-full object-cover', mirrored && 'scale-x-[-1]')}
          />
        ) : (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-slate-950/80">
            <img
              src={imagePath}
              alt={label}
              className={cn(
                'max-h-[70%] max-w-[85%] rounded-lg object-cover shadow-lg',
                mirrored && 'scale-x-[-1]'
              )}
            />
            <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
              Đã chụp
            </span>
          </div>
        )
      )}
    </div>
  );
};
