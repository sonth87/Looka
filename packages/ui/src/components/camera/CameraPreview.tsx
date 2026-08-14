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
}

export const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  mirrored = true,
  aspectRatio = '16/9',
  className,
  videoClassName,
  overlayCanvasRef,
  children,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
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
          mirrored && 'scale-x-[-1]',
          videoClassName
        )}
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
