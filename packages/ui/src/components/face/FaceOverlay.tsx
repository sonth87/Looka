import React from 'react';
import { FaceState, FaceLandmark, BoundingBox } from '@face/core';
import { cn } from '../../lib/utils.js';

export interface FaceOverlayProps {
  faceState?: FaceState | null;
  showLandmarks?: boolean;
  landmarkSize?: number; // in pixels (default 1.5)
  mirrored?: boolean;
  visible?: boolean;
  opacity?: number; // 0..1 (1.0 = 100% full original opacity)
  /**
   * 'capture': Dynamic tracking bounding box với corner brackets & pulse glow (GuidedCaptureScreen).
   * 'recognition': High-tech scanner frame + person label (KioskAttendanceScreen).
   * Default: 'capture'
   */
  variant?: 'capture' | 'recognition';
  personLabel?: string;
  className?: string;
}

interface FaceItem {
  index: number;
  boundingBox: BoundingBox;
  landmarks?: FaceLandmark[];
}

export const FaceOverlay: React.FC<FaceOverlayProps> = ({
  faceState,
  showLandmarks = false,
  landmarkSize = 1.5,
  mirrored = true,
  visible = true,
  opacity = 1.0,
  variant = 'capture',
  personLabel,
  className,
}) => {
  if (!visible || !faceState || !faceState.detected) {
    return null;
  }

  const isAccepted = faceState.quality?.accepted ?? false;
  const isMultiple = faceState.presence === 'MULTIPLE_FACES' || (faceState.faceCount ?? 0) > 1;

  // Build array of all faces to render
  const faces: FaceItem[] = [];

  if (faceState.allDetections && faceState.allDetections.length > 0) {
    faceState.allDetections.forEach((det, idx) => {
      faces.push({
        index: idx,
        boundingBox: det.boundingBox,
        landmarks: faceState.allLandmarks?.[idx],
      });
    });
  } else if (faceState.detection) {
    faces.push({
      index: 0,
      boundingBox: faceState.detection.boundingBox,
      landmarks: faceState.landmarks,
    });
  }

  if (faces.length === 0) return null;

  return (
    <div
      style={{ opacity }}
      className={cn('absolute inset-0 pointer-events-none overflow-hidden z-20 transition-opacity duration-150', className)}
    >
      {/* Loop over ALL detected faces in the frame */}
      {faces.map((faceItem) => {
        const { index, boundingBox, landmarks } = faceItem;

        // Calculate normalized 0..1 bounding box coordinates
        let minX = 0.3;
        let maxX = 0.7;
        let minY = 0.2;
        let maxY = 0.8;

        if (landmarks && landmarks.length > 0) {
          minX = 1;
          maxX = 0;
          minY = 1;
          maxY = 0;
          for (const lm of landmarks) {
            if (lm.x < minX) minX = lm.x;
            if (lm.x > maxX) maxX = lm.x;
            if (lm.y < minY) minY = lm.y;
            if (lm.y > maxY) maxY = lm.y;
          }
        } else if (boundingBox) {
          minX = boundingBox.x / 640;
          minY = boundingBox.y / 480;
          maxX = (boundingBox.x + boundingBox.width) / 640;
          maxY = (boundingBox.y + boundingBox.height) / 480;
        }

        // Account for horizontal camera preview mirroring
        const finalLeft = mirrored ? 1 - maxX : minX;
        const leftPct = Math.max(0, Math.min(100, finalLeft * 100));
        const topPct = Math.max(0, Math.min(100, minY * 100));
        const widthPct = Math.max(4, Math.min(100, (maxX - minX) * 100));
        const heightPct = Math.max(4, Math.min(100, (maxY - minY) * 100));

        // Color theme: Primary face uses status theme; Secondary faces use Amber multi-face warning theme
        const colorTheme =
          index > 0 || (isMultiple && index !== 0)
            ? {
                bg: 'bg-amber-500/15',
                corner: 'border-amber-300',
                glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]',
                stroke: '#f59e0b',
                labelBg: 'rgba(120,53,15,0.88)',
                labelText: '#f59e0b',
              }
            : isAccepted || personLabel
            ? {
                bg: 'bg-emerald-500/15',
                corner: 'border-emerald-300',
                glow: 'shadow-[0_0_20px_rgba(16,185,129,0.4)]',
                stroke: '#10b981',
                labelBg: 'rgba(6,60,40,0.88)',
                labelText: '#10b981',
              }
            : {
                bg: 'bg-blue-500/15',
                corner: 'border-blue-300',
                glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
                stroke: '#3b82f6',
                labelBg: 'rgba(23,37,84,0.88)',
                labelText: '#60a5fa',
              };

        return (
          <React.Fragment key={index}>
            {/* Dynamic Face Tracking Bounding Box */}
            <div
              className={cn(
                'absolute transition-all duration-150 ease-out rounded-2xl backdrop-blur-[1px]',
                colorTheme.bg,
                colorTheme.glow
              )}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
            >
              {/* 4 Corner Accent Brackets */}
              <div className={cn('absolute -top-1.5 -left-1.5 w-5 h-5 border-t-3 border-l-3 rounded-tl-md', colorTheme.corner)} />
              <div className={cn('absolute -top-1.5 -right-1.5 w-5 h-5 border-t-3 border-r-3 rounded-tr-md', colorTheme.corner)} />
              <div className={cn('absolute -bottom-1.5 -left-1.5 w-5 h-5 border-b-3 border-l-3 rounded-bl-md', colorTheme.corner)} />
              <div className={cn('absolute -bottom-1.5 -right-1.5 w-5 h-5 border-b-3 border-r-3 rounded-br-md', colorTheme.corner)} />

              {/* Multi-face Secondary Badge or Person Label */}
              {index > 0 ? (
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/90 border border-amber-500/50 text-amber-400 shadow-md">
                    ⚠️ Mặt #{index + 1}
                  </div>
                </div>
              ) : (
                variant === 'recognition' &&
                personLabel && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <div
                      style={{ backgroundColor: colorTheme.labelBg, borderColor: colorTheme.stroke + '66' }}
                      className="px-3.5 py-1 rounded-full text-xs font-bold border backdrop-blur-md shadow-xl flex items-center gap-1.5"
                    >
                      <span style={{ color: colorTheme.labelText }}>👤 {personLabel}</span>
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Optional Face Landmarks Points for this face */}
            {showLandmarks && landmarks && landmarks.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {landmarks.map((lm, lmIdx) => {
                  const cx = (mirrored ? 1 - lm.x : lm.x) * 100;
                  const cy = lm.y * 100;
                  return (
                    <circle
                      key={lmIdx}
                      cx={`${cx}%`}
                      cy={`${cy}%`}
                      r={landmarkSize}
                      className={cn(
                        index > 0
                          ? 'fill-amber-400/90 drop-shadow-[0_0_4px_rgba(245,158,11,0.8)]'
                          : 'fill-blue-400/90 drop-shadow-[0_0_4px_rgba(96,165,250,0.8)]'
                      )}
                    />
                  );
                })}
              </svg>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
