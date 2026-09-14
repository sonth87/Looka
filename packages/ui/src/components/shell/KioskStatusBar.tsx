import { HelpCircle, Printer, Radio, Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface KioskCameraStatus {
  id: string;
  /** e.g. "CAM 1 (CHÍNH DIỆN)" */
  label: string;
  ready: boolean;
}

export interface KioskStatusBarProps {
  cameras?: KioskCameraStatus[];
  rfidReady?: boolean;
  rfidLabel?: string;
  printerReady?: boolean;
  /** e.g. "Còn 85" */
  printerStockLabel?: string;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
  className?: string;
}

function StatusChip({ ready, label }: { ready: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-kiosk-border bg-kiosk-surface px-2.5 py-1.5">
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ready ? 'bg-kiosk-accent-2' : 'bg-kiosk-text-muted')}
      />
      <span className="truncate text-[11px] font-medium text-kiosk-text-muted">{label}</span>
    </div>
  );
}

/**
 * Persistent bottom bar shared by every kiosk-operational screen — camera
 * readiness chips (count/labels follow whatever is mapped in Camera Setup,
 * never hardcoded — see `DeviceInitScreen`/`DesktopCaptureView` callers),
 * RFID/CCCD reader status, printer status, and quick access to
 * Settings/Help. See docs plan "Sửa UI desktop app Looka theo 7 ảnh mockup".
 */
export function KioskStatusBar({
  cameras = [],
  rfidReady,
  rfidLabel = 'Đầu đọc RFID/CCCD',
  printerReady,
  printerStockLabel,
  onOpenSettings,
  onOpenHelp,
  className,
}: KioskStatusBarProps) {
  return (
    <footer
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-t border-kiosk-border bg-kiosk-bg/95 px-6 py-2.5 backdrop-blur-md',
        className
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {cameras.map((cam) => (
          <StatusChip key={cam.id} ready={cam.ready} label={cam.label} />
        ))}
        {rfidReady !== undefined && (
          <div className="flex items-center gap-1.5 rounded-lg border border-kiosk-border bg-kiosk-surface px-2.5 py-1.5">
            <Radio className={cn('h-3.5 w-3.5', rfidReady ? 'text-kiosk-accent-2' : 'text-kiosk-text-muted')} />
            <span className="text-[11px] font-medium text-kiosk-text-muted">{rfidLabel}</span>
          </div>
        )}
        {printerReady !== undefined && (
          <div className="flex items-center gap-1.5 rounded-lg border border-kiosk-border bg-kiosk-surface px-2.5 py-1.5">
            <Printer className={cn('h-3.5 w-3.5', printerReady ? 'text-kiosk-accent-2' : 'text-kiosk-text-muted')} />
            <span className="text-[11px] font-medium text-kiosk-text-muted">
              {printerReady ? 'Máy in sẵn sàng' : 'Máy in chưa sẵn sàng'}
              {printerStockLabel ? ` · ${printerStockLabel}` : ''}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 rounded-lg border border-kiosk-border px-2.5 py-1.5 text-[11px] font-medium text-kiosk-text-muted transition-colors hover:border-kiosk-accent/40 hover:text-kiosk-text"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Cài đặt
          </button>
        )}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="flex items-center gap-1.5 rounded-lg border border-kiosk-border px-2.5 py-1.5 text-[11px] font-medium text-kiosk-text-muted transition-colors hover:border-kiosk-accent/40 hover:text-kiosk-text"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Trợ giúp
          </button>
        )}
      </div>
    </footer>
  );
}
