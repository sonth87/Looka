import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { CompositionGridOverlay } from './CompositionGridOverlay.js';

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
   * Whether the LIVE `<video>` preview is flipped horizontally to match a
   * mirrored capture. Default true: every tile here is a live preview for
   * self-positioning during simultaneous capture, same as the main
   * `CameraPreview` (product decision 2026-09-05 — mirror the preview).
   *
   * Only affects the live `<video>` below, NOT the COMPLETED-thumbnail
   * `<img>` — 2026-09-18 field bug fix: this prop used to also flip the
   * saved still, on the stale assumption that the underlying file was
   * always the raw, unmirrored sensor image. Since product decision
   * 2026-09-17 (`BrowserCameraService.setMirrorStills(true)`, extended to
   * every camera role's `snapshotVideoFrame()` still and to CB Help's own
   * `centerPreviewDataUrl` heartbeat — both go through
   * `captureBase64Snapshot()`), the saved/pushed still is ALREADY
   * pixel-mirrored — re-flipping it here silently flipped it right back to
   * looking unmirrored, disagreeing with the live preview the subject just
   * posed in.
   */
  mirrored?: boolean;
  /**
   * This tile's 1-based position in the grid ("CAM 1", "CAM 2", ...) — purely
   * a display prefix derived from render order (`MultiFrameGrid` passes its
   * own `.map` index), not a stored/authoritative camera number. Omitted by
   * `CbHelpFrames.tsx` (renders its own grid without `MultiFrameGrid`), which
   * simply shows no "CAM N" prefix — unchanged from before this prop existed.
   */
  index?: number;
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
  /** Draws a rule-of-thirds framing grid over this tile — the caller decides which tile(s) (CENTER only, per product decision 2026-09-15), this component has no opinion on role. Default false. */
  showCompositionGrid?: boolean;
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
  className,
  mirrored = true,
  size = 'default',
  index,
  showCompositionGrid = false,
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

  // Kiosk navy/cyan palette (docs plan "Sửa UI desktop app Looka theo 7 ảnh
  // mockup" — bước 5 4-cam grid): READY and COMPLETED share the same "green
  // ready" ring family (kiosk-accent-2) per the mockup's green ready-ring
  // treatment; CURRENT (actively being captured) uses the cyan accent;
  // FAILED/MISSING/UNASSIGNED keep their own distinct danger/warning colors
  // so a broken vs. unmapped camera never looks identical. Status semantics
  // (which state maps to which color family) are unchanged from before —
  // only the actual color values moved from the old ad-hoc
  // emerald/blue/rose/amber/slate palette onto the shared kiosk tokens.
  const ringClass =
    status === 'COMPLETED' || status === 'READY'
      ? 'ring-kiosk-accent-2'
      : status === 'CURRENT'
      ? 'ring-kiosk-accent'
      : status === 'FAILED'
      ? 'ring-kiosk-danger'
      : status === 'MISSING' || status === 'UNASSIGNED'
      ? 'ring-kiosk-warning'
      : 'ring-kiosk-border';

  const badgeClass =
    status === 'COMPLETED' || status === 'READY'
      ? 'bg-kiosk-accent-2/90 text-kiosk-bg'
      : status === 'CURRENT'
      ? 'bg-kiosk-accent/90 text-kiosk-bg'
      : status === 'FAILED'
      ? 'bg-kiosk-danger/90 text-white'
      : status === 'MISSING' || status === 'UNASSIGNED'
      ? 'bg-kiosk-warning/90 text-kiosk-bg'
      : 'bg-kiosk-surface-2/90 text-kiosk-text-muted';

  const showReadyCheck = status === 'READY' || status === 'COMPLETED';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl ring-2 transition-colors bg-kiosk-surface',
        !isLarge && 'aspect-video',
        ringClass,
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

      {showCompositionGrid && <CompositionGridOverlay />}

      {/*
        Pose-guide outline for the tile actively being captured — a plain
        dashed circle rather than a real silhouette asset (no such asset
        exists in this package yet), just enough to draw the eye to where the
        subject should be centered while this camera is live.
      */}
      {status === 'CURRENT' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div
            className={cn(
              'aspect-square rounded-full border-2 border-dashed border-kiosk-accent/70 animate-pulse',
              isLarge ? 'w-[55%]' : 'w-[45%]'
            )}
          />
        </div>
      )}

      <div
        className={cn(
          'absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-1 bg-gradient-to-b from-black/70 to-transparent font-semibold text-white',
          isLarge ? 'px-4 py-2 text-base sm:text-lg gap-3' : 'px-2 py-1 text-[10px]'
        )}
      >
        <span className="truncate">
          {typeof index === 'number' ? `CAM ${index + 1} · ` : ''}
          {label} · {roleLabel}
        </span>
        <span className="truncate opacity-80">{deviceLabel ?? 'Chưa gán camera'}</span>
      </div>

      <div
        className={cn(
          'absolute z-10 rounded-full font-bold uppercase flex items-center',
          isLarge ? 'top-2 right-2 px-3 py-1 text-sm sm:text-base gap-1.5' : 'top-1 right-1 px-1.5 py-0.5 text-[9px] gap-0.5',
          badgeClass
        )}
      >
        {showReadyCheck && <Check className={isLarge ? 'w-4 h-4' : 'w-2.5 h-2.5'} strokeWidth={3} />}
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
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-slate-950/80">
            <img
              src={imagePath}
              alt={label}
              className="max-h-[70%] max-w-[85%] rounded-lg object-cover shadow-lg"
            />
            {/*
              2026-09-25 fix (real-hardware field report, "vừa vào tôi chưa
              chụp mà đã hiển thị đã chụp"): this "Đã chụp" pill used to be
              unconditional, but the image above it isn't always a real
              capture — the `!stream` half of this block's own condition
              (just above) exists specifically for a tethered/CB-Help tile
              showing a live PREVIEW still in place of a `MediaStream` it will
              never have, independent of whether the step has actually been
              captured yet (`status` stays PENDING/CURRENT the whole time a
              tethered CENTER tile is merely live-previewing). Gating the
              label on the real `status` — not just "an image is showing" —
              stops a not-yet-captured tethered preview from lying about
              being done.
            */}
            {status === 'COMPLETED' && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                Đã chụp
              </span>
            )}
          </div>
        )
      )}
    </div>
  );
};
