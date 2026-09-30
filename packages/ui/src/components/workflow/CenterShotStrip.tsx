import React from 'react';
import { cn } from '../../lib/utils.js';

/**
 * Multi-shot CENTER camera: the two presentational pieces that show "which of
 * the center photos is selected" — the "Ảnh k/N" badge and the strip of
 * thumbnails. Rendered by BOTH the review modal (`SessionReviewModal`, where
 * the operator picks) and the extended display (`CbHelpFrames.tsx` in
 * apps/desktop, where the student watches the same pick), and requirement 4
 * is that the two say the same thing — so the wording ("Đang chọn", "Ảnh k")
 * and the selected-tile highlight live here once, and each caller only adds
 * its own sizing/position through `className` props.
 */

/** The "Ảnh k/N" badge: which center photo is selected out of how many. Position and size come from `className` (each surface places it differently). */
export const ShotCountBadge: React.FC<{ selectedIndex: number; count: number; className?: string }> = ({
  selectedIndex,
  count,
  className,
}) => (
  <span className={cn('bg-blue-600/90 font-bold text-white', className)}>
    Ảnh {selectedIndex + 1}/{count}
  </span>
);

export interface CenterShotStripProps {
  /** How many shots there are — one tile each, whether or not a preview exists for it. */
  count: number;
  /** `thumbnails[i]` is shot `i`'s preview image; a missing or empty entry draws a blank tile. */
  thumbnails: ReadonlyArray<string | null | undefined>;
  selectedIndex: number;
  /** When given, every tile is a button that picks its shot; without it the tiles are plain, non-interactive boxes. */
  onSelect?: (index: number) => void;
  /** Stable per-shot React keys (e.g. attempt numbers). Defaults to the index. */
  itemKeys?: ReadonlyArray<string | number>;
  /** Container layout (gap, padding, overflow, justification) — supplied by the caller. */
  className?: string;
  /** Size and corner radius of one tile — supplied by the caller. */
  tileClassName?: string;
  /** Sizing of the `<img>` inside a tile — supplied by the caller. */
  imageClassName?: string;
}

/**
 * The strip of center-shot thumbnails with the selected one highlighted and
 * captioned "Đang chọn" (the others "Ảnh k"). Thumbnails are expected to be
 * already pixel-mirrored stills, so no CSS flip is applied here.
 */
export const CenterShotStrip: React.FC<CenterShotStripProps> = ({
  count,
  thumbnails,
  selectedIndex,
  onSelect,
  itemKeys,
  className,
  tileClassName,
  imageClassName,
}) => (
  <div className={cn('flex', className)}>
    {Array.from({ length: count }, (_, i) => {
      const selected = i === selectedIndex;
      const thumb = thumbnails[i];
      const tileClasses = cn(
        'relative shrink-0 overflow-hidden border-2 bg-slate-900 transition-all',
        selected
          ? 'border-blue-400 ring-2 ring-blue-500/50 shadow-lg shadow-blue-500/20'
          : cn('border-slate-700 opacity-70', onSelect && 'hover:border-slate-500 hover:opacity-100'),
        tileClassName
      );
      const content = (
        <>
          {thumb ? (
            <img src={thumb} alt={`Ảnh camera giữa ${i + 1}`} className={cn('h-full w-full object-cover', imageClassName)} />
          ) : (
            <div className={cn('h-full w-full bg-slate-900', imageClassName)} />
          )}
          <span
            className={cn(
              'absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-bold',
              selected ? 'bg-blue-600 text-white' : 'bg-slate-950/80 text-slate-300'
            )}
          >
            {selected ? 'Đang chọn' : `Ảnh ${i + 1}`}
          </span>
        </>
      );
      const key = itemKeys?.[i] ?? i;

      if (!onSelect) {
        return (
          <div key={key} className={tileClasses}>
            {content}
          </div>
        );
      }
      return (
        <button
          key={key}
          type="button"
          // Never takes keyboard focus: a focused <button> makes the window-level
          // Enter handler in FaceCaptureApp stand down, so Enter would stop
          // meaning "chụp thêm" (see the review modal's root comment).
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(i)}
          className={cn(tileClasses, 'cursor-pointer')}
          title={selected ? 'Đang chọn' : `Chọn ảnh ${i + 1}`}
        >
          {content}
        </button>
      );
    })}
  </div>
);
