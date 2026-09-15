import React from 'react';
import { cn } from '../../lib/utils.js';

export interface CompositionGridOverlayProps {
  className?: string;
}

/**
 * Rule-of-thirds style 3x3 framing grid drawn over a camera preview, to help
 * position the subject before capture — CENTER camera only, on by default
 * (2026-09-15 product decision: "lưới trên cam center, mặc định là bật").
 * Purely visual: never read by any capture/quality/pose gating logic.
 */
export const CompositionGridOverlay: React.FC<CompositionGridOverlayProps> = ({ className }) => (
  <div className={cn('pointer-events-none absolute inset-0 z-[6]', className)}>
    <div className="absolute left-1/3 top-0 h-full w-px bg-white/35" />
    <div className="absolute left-2/3 top-0 h-full w-px bg-white/35" />
    <div className="absolute top-1/3 left-0 w-full h-px bg-white/35" />
    <div className="absolute top-2/3 left-0 w-full h-px bg-white/35" />
  </div>
);
