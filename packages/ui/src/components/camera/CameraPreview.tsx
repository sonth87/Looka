import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils.js';

export interface CameraPreviewProps {
  stream: MediaStream | null;
  mirrored?: boolean;
  aspectRatio?: '16/9' | '4/3' | '3/4' | '1/1' | 'auto';
  className?: string;
  videoClassName?: string;
  overlayCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  children?: React.ReactNode;
  /**
   * Digital zoom applied to the preview, matching BrowserCameraService's
   * software crop+scale for cameras with no hardware zoom (1 = no zoom).
   *
   * Composed into a single inline `transform` alongside mirroring: an inline
   * style always wins over the `scale-x-[-1]` utility class, so mirroring
   * has to be folded in here rather than left on the class once this prop is
   * in play, or it would silently stop mirroring.
   */
  zoomScale?: number;
  /**
   * Digital zoom's crop centre, as a ratio of the frame (0.5, 0.5 = middle) —
   * matches BrowserCameraService.getDigitalZoomCenter(). Ignored below 1x.
   *
   * CSS `scale()` enlarges around `transform-origin` (the box centre, by
   * default) while leaving that point fixed on screen — it does not, by
   * itself, recentre a crop window that sits off to one side. Reproducing an
   * arbitrary off-centre crop+fill needs an accompanying `translate()`, which
   * in `transform: scale(s) translate(dx%, dy%)` applies to the point BEFORE
   * scale does (rightmost function first). Solving "the point at (cx, cy)
   * must land at the origin (0.5, 0.5) once scaled" for dx gives
   * `dx = 0.5 - cx` — independent of s, since scaling zero is still zero.
   */
  zoomOrigin?: { x: number; y: number };
}

export const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  mirrored = true,
  aspectRatio = '16/9',
  className,
  videoClassName,
  overlayCanvasRef,
  children,
  zoomScale = 1,
  zoomOrigin = { x: 0.5, y: 0.5 },
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      // Was a silent catch — a play() rejection here means the stream is
      // "live" at the JS API level but nothing ever actually decodes, which
      // is indistinguishable from a working-but-black preview without this.
      video.play().catch((err) =>
        console.error(
          `[CameraPreview] video.play() failed: name=${err?.name} message=${err?.message} readyState=${video.readyState} videoWidth=${video.videoWidth} videoHeight=${video.videoHeight}`
        )
      );
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  const aspectRatioClass =
    aspectRatio === '16/9'
      ? 'aspect-video'
      : aspectRatio === '4/3'
      ? 'aspect-[4/3]'
      : aspectRatio === '3/4'
      ? 'aspect-[3/4]'
      : aspectRatio === '1/1'
      ? 'aspect-square'
      : '';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        aspectRatioClass,
        className
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'w-full h-full object-cover transition-transform duration-300',
          // The class only handles mirroring when no zoom is in play; once
          // zoomed, the inline style below takes over both so the two never
          // fight over the same transform.
          mirrored && zoomScale <= 1.001 && 'scale-x-[-1]',
          videoClassName
        )}
        style={
          zoomScale > 1.001
            ? {
                transform: `scale(${mirrored ? -zoomScale : zoomScale}, ${zoomScale}) translate(${(
                  0.5 - zoomOrigin.x
                ) * 100}%, ${(0.5 - zoomOrigin.y) * 100}%)`,
              }
            : undefined
        }
      />

      {overlayCanvasRef && (
        <canvas
          ref={overlayCanvasRef}
          className={cn(
            'absolute inset-0 pointer-events-none w-full h-full',
            mirrored && 'scale-x-[-1]'
          )}
        />
      )}

      {/*
        Overlays sit on top of the video and must not swallow clicks, so the
        whole layer is inert by default. Anything interactive placed in here —
        a shutter, a start button — has to opt back in with pointer-events-auto,
        or it will render perfectly and simply refuse to respond.
      */}
      {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
    </div>
  );
};
