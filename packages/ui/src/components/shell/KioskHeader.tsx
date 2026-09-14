import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LookaIcon } from '../theme/LookaIcon.js';
import { cn } from '../../lib/utils.js';

export interface KioskHeaderProps {
  systemTitle?: string;
  stationName?: string;
  operatorName?: string;
  shiftLabel?: string;
  /**
   * Shows a "Quay lại" arrow button left of the brand block when provided.
   * Omit on screens with nothing sensible to go back to (e.g. `StandbyScreen`,
   * `DeviceInitScreen` itself) — callers decide per-screen, this component
   * doesn't guess.
   */
  onBack?: () => void;
  /** Extra controls rendered at the far right, before the clock (e.g. a screen's own mode toggle). */
  right?: React.ReactNode;
  className?: string;
}

/**
 * Persistent top bar shared by every kiosk-operational screen (device init,
 * check-in, capture, guide/mirror) — see docs plan "Sửa UI desktop app Looka
 * theo 7 ảnh mockup". Not used on `LoginScreen` (no mockup covers it).
 */
export function KioskHeader({
  systemTitle = 'Hệ thống chụp ảnh tự động',
  stationName,
  operatorName,
  shiftLabel,
  onBack,
  right,
  className,
}: KioskHeaderProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className={cn(
        'flex shrink-0 items-center justify-between gap-4 border-b border-kiosk-border bg-kiosk-bg/95 px-6 py-3 backdrop-blur-md',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Quay lại"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kiosk-border text-kiosk-text-muted transition-colors hover:border-kiosk-accent/40 hover:text-kiosk-text"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="h-8 w-8 shrink-0">
          <LookaIcon className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-wide text-kiosk-text">{systemTitle}</div>
          {stationName && <div className="truncate text-xs text-kiosk-text-muted">{stationName}</div>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {right}
        {operatorName && (
          <div className="flex items-center gap-2.5 rounded-xl border border-kiosk-border bg-kiosk-surface px-3 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kiosk-accent/20 text-[11px] font-bold text-kiosk-accent">
              {(operatorName || '?').trim().charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <div className="max-w-[12rem] truncate text-xs font-medium text-kiosk-text">{operatorName}</div>
              {shiftLabel && <div className="text-[11px] text-kiosk-text-muted">{shiftLabel}</div>}
            </div>
          </div>
        )}
        <div className="text-right leading-tight">
          <div className="font-mono text-sm font-semibold text-kiosk-text">
            {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-[11px] text-kiosk-text-muted">
            {now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </div>
        </div>
      </div>
    </header>
  );
}
