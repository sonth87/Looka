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
    <div className={cn('grid gap-2 w-full', gridColsClass, className)}>
      {frames.map(({ stepId, ...tileProps }) => (
        <FrameTile key={stepId} {...tileProps} theme={theme} />
      ))}
    </div>
  );
};
