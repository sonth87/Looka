import { useEffect, useRef, useState } from 'react';

/**
 * Pre-session "quét thẻ CCCD" overlay (2026-09-09) — the kiosk's full
 * replacement for `StudentIdEntryScreen`'s manual "nhập mã sinh viên" form,
 * per the product decision that CCCD scanning replaces manual entry
 * outright rather than the two coexisting (see `FaceCaptureApp.tsx`'s own
 * doc comment on `handleCccdScan` for why `StudentIdEntryScreen` itself is
 * kept, unmodified, for the non-kiosk/legacy path that has no scanner
 * attached — `apps/web`).
 *
 * No form here: there is nothing for the operator to submit manually — the
 * scan-monitor corner below (`ScanMonitorCorner`) listens for a dedicated
 * barcode/QR scanner reading the card and, once it gets a clean read, asks
 * the kiosk's main process whether that citizen id matches anyone in the
 * external student roster (see `onScanResult`'s own doc comment).
 * 2026-09-10: replaced the original bridged-phone-camera + Tesseract OCR
 * corner outright (removed, not toggled — a dedicated hardware scanner is
 * now required on every kiosk) — see `ScanMonitorCorner`'s own doc comment
 * for how a physical scanner is actually read.
 *
 * The wrapper below is `pointer-events-none` (only the two islands inside
 * it — the status card and the scan-monitor corner — are
 * `pointer-events-auto`) — clicks elsewhere fall through to whatever the
 * underlying capture view renders, INCLUDING its "Bắt đầu"/"Màn hình mở
 * rộng"/"Cài đặt camera" controls. That's deliberate, not an oversight
 * (2026-09-09, reverted from a brief attempt at blocking the whole
 * overlay): the toolbar controls must stay reachable at any time regardless
 * of identification state (operator/admin controls, not student-facing),
 * and "Bắt đầu" starting a session before a student is identified is
 * prevented at the function level instead — see `handleStartWorkflow`'s own
 * `fromIdentification` doc comment in `FaceCaptureApp.tsx` — so blocking
 * clicks here was never actually necessary for that, and blocking the
 * toolbar along with it was collateral damage worth avoiding.
 */
export interface CccdScanWaitingScreenProps {
  /** True while a scanned CCCD is being looked up against the roster, or during the post-FOUND greeting wait — same "form stays disabled" meaning `StudentIdEntryScreen.submitting` already has. */
  submitting: boolean;
  /** Set by the caller on a NOT_FOUND roster match (or a lookup failure); cleared on the next scan attempt. */
  error: string | null;
  /** Forwarded straight through to `ScanMonitorCorner` — see that component's own `onScanResult` doc comment. */
  onScanResult: (result: CccdRosterLookupResult) => void;
}

export function CccdScanWaitingScreen({ submitting, error, onScanResult }: CccdScanWaitingScreenProps) {
  return (
    <div className="absolute inset-0 z-[150] flex flex-col items-center justify-end pb-16 px-8 text-center pointer-events-none">
      <ScanMonitorCorner paused={submitting} onScanResult={onScanResult} />
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

/** Max gap, in ms, between two keystrokes still considered part of the same scanner burst — see `ScanMonitorCorner`'s own doc comment for why this is how a scan is told apart from ordinary typing. */
const SCAN_BURST_GAP_MS = 80;
/** How long a clean scan's parsed number stays visible before the roster lookup fires — an operator glance-check, not a blocking gate. */
const STABLE_DISPLAY_MS = 400;
/** How long the found/not-found flash stays up before the corner resumes listening for the next student. */
const SUCCESS_DISPLAY_MS = 1800;

/** Vietnamese CCCD numbers are exactly 12 digits — the acceptance gate for the scanner's decoded first field, same shape the old OCR path enforced on its own recognized text. */
const CCCD_NUMBER_PATTERN = /^\d{12}$/;

type ScanPhase = 'idle' | 'stable' | 'checking' | 'check-error' | 'found' | 'not-found';

/** One roster record's display-relevant fields — mirrors `apps/desktop/src/main/cccdRoster.ts`'s `RosterRecord` (the duplicate-the-IPC-payload-shape convention every `faceAPI` caller in this package already follows, since this package cannot import apps/desktop's own types). */
export interface CccdRosterLookupRecord {
  identityNumber: string;
  userCode: string;
  studentCode: string | null;
  fullName: string | null;
  className: string | null;
  majorName: string | null;
  courseYear: string | null;
}

/**
 * `faceAPI.lookupCccdByIdentityNumber`'s result, handed straight up to
 * `FaceCaptureApp.tsx` via `onScanResult` — `found: false` is a normal,
 * expected outcome (the scanned citizen id simply isn't anywhere in the
 * roster), never an error. The corner's own job stops here: it does not
 * decide what a match or a non-match MEANS (greeting, session start, the
 * "không có trong dữ liệu" message) — that stays in `FaceCaptureApp.tsx`,
 * same as it already owns that decision for the manual "nhập mã sinh viên"
 * path.
 */
export type CccdRosterLookupResult = { found: true; record: CccdRosterLookupRecord } | { found: false };

/**
 * Pulls the CCCD number out of a decoded QR payload. A Vietnamese chip-based
 * CCCD's front-side QR code encodes one pipe-delimited string:
 * `<số CCCD>|<số CMND cũ, có thể rỗng>|<họ tên>|<ngày sinh>|<giới tính>|<địa chỉ>|<ngày cấp>`
 * — only the first field is ever used here (matching, not display; the
 * roster lookup already returns the subject's real name/class/major once
 * matched). `null` for anything that doesn't start with a clean 12-digit
 * token — a garbled/partial read (e.g. a keystroke lost to focus moving
 * mid-scan) must never be treated as a match, the same "only a clean read
 * counts" gate the old OCR path enforced via `extractCitizenId`.
 */
export function extractCitizenIdFromQrPayload(raw: string): string | null {
  const firstField = raw.split('|')[0]?.trim() ?? '';
  return CCCD_NUMBER_PATTERN.test(firstField) ? firstField : null;
}

/**
 * Bottom-right "CCCD scanner" status corner — 2026-09-10, replaces the
 * previous bridged-phone-camera + Tesseract OCR corner outright (a
 * dedicated hardware scanner is now required on every kiosk, not an
 * optional/toggleable alternative).
 *
 * Every commercial USB/Bluetooth barcode/QR scanner emulates a keyboard by
 * default ("HID keyboard wedge" mode — no driver or SDK needed): scanning a
 * code "types" its decoded contents into whichever element currently has
 * keyboard focus, then sends Enter. So this listens for keystrokes at the
 * `document` level instead of opening a camera.
 *
 * Telling a genuine scan apart from ordinary typing elsewhere on the page:
 * a scanner delivers every character of one decode within a few ms of the
 * previous one — see `SCAN_BURST_GAP_MS`. Any gap larger than that resets
 * the buffer, so no plausible human typing speed can ever accumulate into a
 * false scan. Belt-and-suspenders: any keystroke while a real
 * `<input>`/`<textarea>`/contenteditable element has focus is ignored
 * outright, so an operator legitimately typing into a real form elsewhere
 * on the page is never mistaken for a scan.
 *
 * `paused` (true while the parent's handling of a previous result —
 * greeting, session start — is still in flight, i.e. `submitting`) stops
 * accepting new keystrokes without unmounting anything, matching the old
 * corner's own pause behaviour so the corner doesn't visibly flicker/reset
 * between one student's scan and the next.
 */
function ScanMonitorCorner({
  paused,
  onScanResult,
}: {
  paused: boolean;
  onScanResult: (result: CccdRosterLookupResult) => void;
}) {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [stableCitizenId, setStableCitizenId] = useState<string | null>(null);

  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    if (paused) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isRealInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isRealInput) return;

      const now = Date.now();
      if (now - lastKeyAtRef.current > SCAN_BURST_GAP_MS) {
        bufferRef.current = '';
      }
      lastKeyAtRef.current = now;

      if (e.key === 'Enter') {
        const raw = bufferRef.current;
        bufferRef.current = '';
        if (!raw) return;
        const citizenId = extractCitizenIdFromQrPayload(raw);
        if (!citizenId) {
          setStatusText('Đọc thẻ không thành công, vui lòng quét lại.');
          return;
        }
        setStableCitizenId(citizenId);
        setPhase('stable');
        return;
      }

      // Single printable characters only — ignores modifier/navigation keys
      // (Shift, Control, ArrowLeft, ...) so they don't contribute to the
      // buffer, without treating them as a burst-breaking pause either
      // (`lastKeyAtRef` above is already updated regardless of this check).
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paused]);

  // Clean read -> brief glance window -> roster lookup. Same "auto-confirm,
  // shown briefly for a glance, not a blocking tap" product decision the
  // OCR path already made — no per-read stability streak needed here (a
  // scanner decode is an exact read, not a noisy repeated guess).
  useEffect(() => {
    if (phase !== 'stable' || !stableCitizenId) return;
    const citizenId = stableCitizenId;
    const timer = setTimeout(() => {
      setPhase('checking');
      const faceAPI = (window as any).faceAPI;
      const lookup = faceAPI?.lookupCccdByIdentityNumber;
      if (!lookup) {
        // Web build, or no bridge — nothing to check against here; go back
        // to idle rather than getting stuck. This component is only ever
        // mounted on the kiosk build in practice (see `FaceCaptureApp.tsx`'s
        // own render gate), so this is defensive, not an expected path.
        setPhase('idle');
        return;
      }
      lookup({ identityNumber: citizenId })
        .then((result: CccdRosterLookupResult) => {
          onScanResult(result);
          setPhase(result.found ? 'found' : 'not-found');
          setTimeout(() => {
            setStableCitizenId(null);
            setStatusText(null);
            setPhase('idle');
          }, SUCCESS_DISPLAY_MS);
        })
        .catch((err: unknown) => {
          setStatusText(err instanceof Error ? err.message : String(err));
          setPhase('check-error');
        });
    }, STABLE_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stableCitizenId]);

  function retryAfterCheckError() {
    setStableCitizenId(null);
    setStatusText(null);
    setPhase('idle');
  }

  return (
    <div className="pointer-events-auto absolute bottom-6 right-6 w-44 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950/90 shadow-xl">
      <div className="flex flex-col items-center justify-center gap-1 px-2 py-4 text-center">
        <span className="text-lg">🪪</span>
        <span className="text-[10px] text-slate-500">Máy quét mã CCCD</span>
      </div>

      {phase === 'stable' && stableCitizenId && (
        <div className="bg-sky-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
          {stableCitizenId}
        </div>
      )}
      {phase === 'checking' && (
        <div className="bg-slate-900/90 px-2 py-1 text-center text-[10px] text-slate-200">Đang kiểm tra...</div>
      )}
      {phase === 'found' && (
        <div className="bg-emerald-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
          Đã tìm thấy ✓
        </div>
      )}
      {phase === 'not-found' && (
        <div className="bg-amber-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white">
          Không có trong danh sách
        </div>
      )}
      {phase === 'check-error' && (
        <button
          type="button"
          onClick={retryAfterCheckError}
          className="w-full bg-rose-600/95 px-2 py-1 text-center text-[10px] font-semibold text-white"
        >
          Lỗi kiểm tra — chạm để quét lại
        </button>
      )}
      {phase === 'idle' && statusText && (
        <div className="bg-slate-950/80 px-2 py-1 text-center text-[10px] text-slate-300">{statusText}</div>
      )}
    </div>
  );
}
