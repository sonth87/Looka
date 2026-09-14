import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { KioskHeader, type KioskHeaderProps } from './KioskHeader.js';
import { KioskStatusBar, type KioskStatusBarProps } from './KioskStatusBar.js';

export interface KioskShellProps
  extends Omit<KioskHeaderProps, 'className'>,
    Omit<KioskStatusBarProps, 'className'> {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Shared header+footer chrome for every kiosk-operational screen (device
 * init & batch selection, standby, check-in, capture, guide/mirror) — the
 * one piece of UI that's visually identical across all 7 mockups. Not
 * wrapped around `LoginScreen` (no mockup shows a login screen using it).
 *
 * Mounted once per screen around that screen's own content; each screen
 * supplies its own `cameras`/`rfidReady`/`printerReady` snapshot rather than
 * this component owning any of that state itself, so callers stay in full
 * control of where that data comes from (e.g. `faceAPI.getCameraRoleMapping()`).
 */
export function KioskShell({
  systemTitle,
  stationName,
  operatorName,
  shiftLabel,
  onBack,
  right,
  cameras,
  rfidReady,
  rfidLabel,
  printerReady,
  printerStockLabel,
  onOpenSettings,
  onOpenHelp,
  children,
  className,
  contentClassName,
}: KioskShellProps) {
  return (
    <div className={cn('flex h-full w-full flex-col bg-kiosk-bg text-kiosk-text', className)}>
      <KioskHeader
        systemTitle={systemTitle}
        stationName={stationName}
        operatorName={operatorName}
        shiftLabel={shiftLabel}
        onBack={onBack}
        right={right}
      />
      <div className={cn('flex-1 overflow-hidden', contentClassName)}>{children}</div>
      <KioskStatusBar
        cameras={cameras}
        rfidReady={rfidReady}
        rfidLabel={rfidLabel}
        printerReady={printerReady}
        printerStockLabel={printerStockLabel}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
      />
    </div>
  );
}
