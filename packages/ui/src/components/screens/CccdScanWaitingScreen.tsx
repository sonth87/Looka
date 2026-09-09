/**
 * Pre-session "quét thẻ CCCD" overlay (2026-09-09) — the kiosk's full
 * replacement for `StudentIdEntryScreen`'s manual "nhập mã sinh viên" form,
 * per the product decision that CCCD scanning replaces manual entry
 * outright rather than the two coexisting (see `FaceCaptureApp.tsx`'s own
 * doc comment on `handleCccdScan` for why `StudentIdEntryScreen` itself is
 * kept, unmodified, for the non-kiosk/legacy path that has no scanner
 * attached — `apps/web`).
 *
 * No form here: there is nothing for the operator to submit. The kiosk's
 * main process watches the external scanner's output file
 * (`apps/desktop/src/main/cccdWatcher.ts`) and pushes each scan over IPC;
 * this screen is purely a "waiting/processing/error" display, the same
 * translucent-over-live-camera-preview footprint `StudentIdEntryScreen`
 * already established (2026-09-08 product feedback: the live preview must
 * stay visible underneath so the operator can see the next person is
 * framed correctly).
 */
export interface CccdScanWaitingScreenProps {
  /** True while a scanned CCCD is being looked up against the roster, or during the post-FOUND greeting wait — same "form stays disabled" meaning `StudentIdEntryScreen.submitting` already has. */
  submitting: boolean;
  /** Set by the caller on a NOT_FOUND roster match (or a lookup failure); cleared on the next scan attempt. */
  error: string | null;
}

export function CccdScanWaitingScreen({ submitting, error }: CccdScanWaitingScreenProps) {
  return (
    <div className="absolute inset-0 z-[150] flex flex-col items-center justify-end pb-16 px-8 text-center pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-950/70 backdrop-blur-md px-6 py-6 shadow-2xl">
        <span className="text-4xl">🪪</span>
        <h2 className="text-xl font-semibold">Quét thẻ căn cước công dân</h2>
        <p className="text-sm text-slate-300">
          {submitting ? 'Đang kiểm tra thông tin...' : 'Vui lòng đưa thẻ CCCD vào đầu đọc để bắt đầu phiên chụp.'}
        </p>
        {submitting && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
          </div>
        )}
        {error && (
          <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
