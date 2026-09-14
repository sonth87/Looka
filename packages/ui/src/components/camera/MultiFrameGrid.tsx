import React from 'react';
import { FrameTile, FrameTileProps } from './FrameTile.js';
import { cn } from '../../lib/utils.js';

export interface MultiFrameGridFrame extends FrameTileProps {
  stepId: string;
}

export interface MultiFrameGridProps {
  frames: MultiFrameGridFrame[];
  theme?: 'dark' | 'light';
  className?: string;
  /** "Lưới 3x3" kiosk setting (2026-09-10) — always lays out 3 tiles per row (wrapping to further rows) instead of the default per-count layout below. There are only ever up to 5 camera roles (CENTER/LEFT/RIGHT/UP/DOWN — see `@face/core`'s `CAMERA_ROLES`), so this never produces a literal 9-cell grid; it's "3 per row, however many rows that takes." */
  forceThreePerRow?: boolean;
}

/**
 * Lays out the campaign's frames for simultaneous capture: 3 or fewer sit in
 * one row, 4-5 wrap onto a second row. Column counts are literal Tailwind
 * classes (not string-interpolated) so the JIT scanner actually picks them
 * up — see Tailwind's static-analysis requirement.
 */
export const MultiFrameGrid: React.FC<MultiFrameGridProps> = ({
  frames,
  theme = 'dark',
  className,
  forceThreePerRow = false,
}) => {
  const gridColsClass = forceThreePerRow
    ? 'grid-cols-1 sm:grid-cols-3'
    : frames.length <= 1
      ? 'grid-cols-1'
      : frames.length === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : frames.length === 3
      ? 'grid-cols-1 sm:grid-cols-3'
      : frames.length === 4
      ? 'grid-cols-2'
      : 'grid-cols-2 sm:grid-cols-3'; // 5 frames: 3 + 2

  return (
    <div
      className={cn(
        // Kiosk panel treatment (docs plan "Sửa UI desktop app Looka theo 7
        // ảnh mockup" — bước 5): a bordered navy panel around the tiles
        // instead of a bare grid sitting directly on the camera-stage
        // background, matching the mockup's grid framing. Column-count logic
        // above is untouched — only spacing/background changed.
        'grid gap-3 w-full p-3 rounded-2xl border border-kiosk-border bg-kiosk-surface/60',
        gridColsClass,
        className
      )}
    >
      {frames.map(({ stepId, ...tileProps }, idx) => (
        <FrameTile key={stepId} {...tileProps} index={idx} theme={theme} />
      ))}
    </div>
  );
};
