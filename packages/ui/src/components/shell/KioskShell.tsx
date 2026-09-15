import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { applyKioskTheme, getStoredKioskTheme, type KioskTheme } from '../../lib/kioskTheme.js';
import { KioskHeader, type KioskHeaderProps } from './KioskHeader.js';
import { KioskStatusBar, type KioskStatusBarProps } from './KioskStatusBar.js';

export interface KioskShellProps
  extends Omit<KioskHeaderProps, 'className' | 'theme' | 'onToggleTheme'>,
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
 *
 * Owns light/dark theme state itself (not lifted to callers) and applies
 * `dark`/`light` DIRECTLY on its own root element — 2026-09-15 fix:
 * `apps/desktop`'s `DeviceLayout` wrapper (`colorScheme="dark"`) renders a
 * permanent `class="... dark"` div between `<html>` and every kiosk screen,
 * so toggling `document.documentElement`'s class alone never reached kiosk
 * content (that closer ancestor's `.dark` rule wins via normal CSS
 * inheritance). Self-applying the class here means it wins regardless of
 * what that ancestor does. `applyKioskTheme()` is still called too, for
 * persistence and for anything rendered via a portal outside this subtree
 * (e.g. a future tooltip/modal mounted on `document.body`).
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
  const [theme, setTheme] = useState<KioskTheme>(() => getStoredKioskTheme());

  function handleToggleTheme() {
    const next: KioskTheme = theme === 'dark' ? 'light' : 'dark';
    applyKioskTheme(next);
    setTheme(next);
  }

  return (
    <div className={cn('flex h-full w-full flex-col bg-kiosk-bg text-kiosk-text', theme, className)}>
      <KioskHeader
        systemTitle={systemTitle}
        stationName={stationName}
        operatorName={operatorName}
        shiftLabel={shiftLabel}
        onBack={onBack}
        theme={theme}
        onToggleTheme={handleToggleTheme}
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
