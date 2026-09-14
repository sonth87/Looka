import { LookaIcon } from '../theme/LookaIcon.js';

export interface StandbyScreenProps {
  /** Kiosk/station name, when known — same value `KioskShell`'s header shows. */
  stationName?: string;
}

/**
 * S1.5 (ui-redesign-plan.md "Bước 1 — Standby") — a minimal idle screen shown
 * for the brief window between a successful login and this kiosk's first
 * campaign-list fetch resolving. Replaces what used to be either a blank
 * frame or `CampaignPickerScreen`'s own inline spinner for that same window;
 * this now runs `CampaignGate.tsx`, and this screen is what a station shows
 * before `campaigns` is known one way or the other.
 *
 * Deliberately content-light: no data lives here, nothing to fetch or wire
 * up — it exists purely so the kiosk never shows a dead/blank frame while
 * `CampaignGate` does its first round trip. Always rendered inside
 * `KioskShell` by the caller (see `CampaignGate.tsx`), so no header/footer of
 * its own.
 */
export function StandbyScreen({ stationName }: StandbyScreenProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-kiosk-bg px-6 text-kiosk-text">
      <div className="h-24 w-24 animate-pulse opacity-90">
        <LookaIcon className="h-full w-full" />
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="text-lg font-semibold tracking-tight text-kiosk-text">Looka</div>
        {stationName && <div className="text-sm text-kiosk-text-muted">{stationName}</div>}
      </div>

      <div className="flex items-center gap-2.5 rounded-full border border-kiosk-border bg-kiosk-surface px-4 py-2">
        <span className="h-2 w-2 animate-ping rounded-full bg-kiosk-accent" />
        <span className="text-sm font-medium text-kiosk-text-muted">Đang tải dữ liệu trạm…</span>
      </div>
    </div>
  );
}
