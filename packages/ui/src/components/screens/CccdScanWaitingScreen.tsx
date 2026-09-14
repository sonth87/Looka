import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StudentSubjectInfo } from '../../lib/CaptureSink.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { StudentProfileCard } from './StudentProfileCard.js';

/**
 * Full-screen "BƯỚC 2: CHECK-IN & ĐỐI SOÁT HỒ SƠ" step (ui-redesign-plan.md,
 * "Bước 4 — Check-in & đối soát hồ sơ" — mockup #5), 2026-09-14 restyle.
 *
 * Was previously a non-blocking `absolute inset-0 pointer-events-none`
 * overlay with two small floating islands over a live camera preview — see
 * git history for that version if it's ever needed for reference. This is
 * now a fully opaque, full-bleed 2-column step screen instead (confirmed
 * safe: `ScanMonitorCorner`'s scanner listener below is a `document`-level
 * keydown listener, not something that ever needed click-through/
 * `pointer-events-none` to keep working — that was only ever about letting
 * clicks reach the camera-preview toolbar underneath, which this step no
 * longer needs to expose). Mounted inside the shared `KioskShell`'s content
 * area by `FaceCaptureApp.tsx` (unchanged `awaitingStudent` gating), so it
 * does not draw its own header/clock/brand bar.
 *
 * Left column: CCCD-scan status (this screen's original purpose, logic
 * unchanged — see `ScanMonitorCorner` below) plus, as of this redesign, a
 * manual "nhập mã sinh viên" fallback field and QR/VNeID stub buttons,
 * because the approved Bước-4 mockup shows both on the same screen. This
 * supersedes the narrower 2026-09-09 decision described further down (manual
 * entry "replaced outright" on the kiosk/campaign path) — flagged here since
 * that was a deliberate product call at the time; the manual field only
 * renders when a caller actually supplies `onManualSubmit` for it.
 * Right column: the matched student's profile (`StudentProfileCard`) once a
 * scan resolves FOUND, otherwise a waiting placeholder. Only the CCCD-scan
 * path can populate this today — see `onManualSubmit`'s own doc comment for
 * why the manual-entry fallback can't (yet).
 */
export interface CccdScanWaitingScreenProps {
  /** True while a scanned CCCD is being looked up against the roster, or during the post-FOUND greeting wait — same "form stays disabled" meaning `StudentIdEntryScreen.submitting` already has. */
  submitting: boolean;
  /** Set by the caller on a NOT_FOUND roster match (or a lookup failure); cleared on the next scan attempt. */
  error: string | null;
  /** Forwarded straight through to `ScanMonitorCorner` — see that component's own `onScanResult` doc comment. */
  onScanResult: (result: CccdRosterLookupResult) => void;
  /**
   * Manual "nhập mã sinh viên" fallback for this same screen (2026-09-14
   * redesign — see this file's top doc comment). `undefined` skips
   * rendering the manual-entry section entirely rather than showing a dead
   * form; `FaceCaptureApp.tsx` wires this to the exact same
   * `handleStudentSubmit` callback the legacy `StudentIdEntryScreen` path
   * already uses.
   *
   * That function's own signature is `(code: string) => void` — it does not
   * hand back the matched record the way `onScanResult` does, so a code
   * entered through this field starts a session exactly like today but
   * cannot (yet) populate the right-column `StudentProfileCard` the way a
   * CCCD scan can; only the scan path has the matched record available
   * locally before forwarding it up (see `handleScanResult` below).
   */
  onManualSubmit?: (code: string) => void;
}

export function CccdScanWaitingScreen({
  submitting,
  error,
  onScanResult,
  onManualSubmit,
}: CccdScanWaitingScreenProps) {
  const [foundSubject, setFoundSubject] = useState<StudentSubjectInfo | null>(null);
  const [manualCode, setManualCode] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  // The scan corner already has the matched roster record in hand before
  // forwarding it up via `onScanResult` — captured here, purely for local
  // display in the right column, without changing that callback's contract
  // (the parent still receives the exact same `CccdRosterLookupResult`).
  const handleScanResult = (result: CccdRosterLookupResult) => {
    setFoundSubject(result.found ? cccdRecordToSubject(result.record) : null);
    onScanResult(result);
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed || submitting || !onManualSubmit) return;
    onManualSubmit(trimmed);
  };

  const focusManualInput = () => manualInputRef.current?.focus();

  return (
    <div className="absolute inset-0 z-[150] flex flex-col overflow-y-auto bg-kiosk-bg text-kiosk-text">
      <div className="shrink-0 px-8 pt-6 pb-2">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-kiosk-accent">Bước 2</div>
        <h1 className="text-2xl font-bold">Check-in &amp; đối soát hồ sơ</h1>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-2">
        {/* Left column — lookup panel */}
        <div className="flex flex-col gap-4">
          <Card variant="panel">
            <CardHeader>
              <CardTitle>Quét thẻ căn cước công dân</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 text-center">
              <span className="text-4xl" aria-hidden>
                🪪
              </span>
              <p className="text-sm text-kiosk-text-muted">
                {submitting
                  ? 'Đang kiểm tra thông tin...'
                  : 'Vui lòng đưa thẻ CCCD vào đầu đọc để bắt đầu phiên chụp.'}
              </p>
              {submitting && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-kiosk-surface-2">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-kiosk-accent" />
                </div>
              )}
              {error && (
                <div className="w-full rounded-lg border border-kiosk-danger/40 bg-kiosk-danger/10 px-4 py-3 text-sm text-kiosk-danger">
                  {error}
                </div>
              )}
              <ScanMonitorCorner paused={submitting} onScanResult={handleScanResult} />
            </CardContent>
          </Card>

          {onManualSubmit && (
            <Card variant="panel">
              <CardHeader>
                <CardTitle>Hoặc nhập mã sinh viên thủ công</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {/*
                    Stubs: no QR/VNeID integration exists yet, so these just
                    focus the manual-entry field below rather than fabricating
                    a scan flow that doesn't exist (honest placeholder per
                    the Bước-4 spec).
                  */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={focusManualInput}
                    title="Chưa có tích hợp quét QR — tạm chuyển sang nhập mã thủ công"
                  >
                    Quét QR
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={focusManualInput}
                    title="Chưa có tích hợp VNeID — tạm chuyển sang nhập mã thủ công"
                  >
                    VNeID
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={focusManualInput}>
                    Nhập mã thủ công
                  </Button>
                </div>
                <form onSubmit={handleManualSubmit} className="flex flex-col gap-3 sm:flex-row">
                  <input
                    ref={manualInputRef}
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Mã sinh viên"
                    disabled={submitting}
                    className="flex-1 rounded-lg border border-kiosk-border bg-kiosk-surface-2 px-4 py-3 text-base text-kiosk-text placeholder:text-kiosk-text-muted focus:outline-none focus:ring-2 focus:ring-kiosk-accent/60 disabled:opacity-50"
                  />
                  <Button type="submit" size="lg" disabled={submitting || !manualCode.trim()}>
                    {submitting ? 'Đang xử lý...' : 'Xác nhận'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — matched student profile */}
        <div className="flex flex-col">
          <StudentProfileCard subject={foundSubject} />
        </div>
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
 * Maps a roster record onto `StudentSubjectInfo` — kept as a local, private
 * mirror of the exact same mapping `FaceCaptureApp.tsx`'s `handleCccdScan`
 * does (this package has no shared helper for it, and that function's
 * mapping is not exported). Used only for this screen's own right-column
 * preview; `FaceCaptureApp.tsx` still builds its own `StudentSubjectInfo`
 * independently from the raw `CccdRosterLookupResult` this component forwards
 * unchanged via `onScanResult`, so a mismatch here can never affect what
 * actually gets recorded for the session.
 */
function cccdRecordToSubject(record: CccdRosterLookupRecord): StudentSubjectInfo {
  return {
    subjectCode: record.studentCode ?? '',
    subjectName: record.fullName ?? '',
    className: record.className ?? '',
    major: record.majorName ?? '',
    academicYear: record.courseYear ?? '',
    identityNumber: record.identityNumber,
    userCode: record.userCode,
  };
}

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
 * "Trạng thái đầu đọc" status strip — 2026-09-10, replaces the previous
 * bridged-phone-camera + Tesseract OCR corner outright (a dedicated hardware
 * scanner is now required on every kiosk, not an optional/toggleable
 * alternative). 2026-09-14: un-cornered — was a fixed `absolute bottom-6
 * right-6` floating box over a live camera preview; now sits inline in the
 * left column's scan card instead, since the screen around it is no longer
 * a see-through overlay. Its event-handling/timers below are UNCHANGED by
 * that move — only the returned JSX's layout classes are.
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
 * on the page (including this same screen's own manual-entry field) is
 * never mistaken for a scan.
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
    <div className="flex w-full items-center justify-center gap-2 border-t border-kiosk-border pt-3">
      <span className="text-xs text-kiosk-text-muted">Trạng thái đầu đọc:</span>
      {phase === 'idle' && !statusText && <Badge variant="neutral">Sẵn sàng</Badge>}
      {phase === 'stable' && stableCitizenId && <Badge variant="info">{stableCitizenId}</Badge>}
      {phase === 'checking' && <Badge variant="neutral">Đang kiểm tra...</Badge>}
      {phase === 'found' && <Badge variant="success">Đã tìm thấy ✓</Badge>}
      {phase === 'not-found' && <Badge variant="warning">Không có trong danh sách</Badge>}
      {phase === 'check-error' && (
        <button
          type="button"
          onClick={retryAfterCheckError}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            'bg-kiosk-danger/15 text-kiosk-danger ring-1 ring-kiosk-danger/30 hover:bg-kiosk-danger/25'
          )}
        >
          Lỗi kiểm tra — chạm để quét lại
        </button>
      )}
      {phase === 'idle' && statusText && <Badge variant="neutral">{statusText}</Badge>}
    </div>
  );
}
