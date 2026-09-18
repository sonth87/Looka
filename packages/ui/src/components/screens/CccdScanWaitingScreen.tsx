import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Monitor } from 'lucide-react';
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
   *
   * 2026-09-18: also forwarded to `ScanMonitorCorner` as `onStudentCodeScan`
   * — a bare (non-CCCD) QR, like a student ID card's, submits through this
   * exact same callback instead of only the visible text field, so both
   * entry methods for a student code end up identical downstream. See
   * `ScanMonitorCorner`'s own `onStudentCodeScan` doc comment for why a
   * SEPARATE detection path was needed rather than reusing the CCCD one.
   */
  onManualSubmit?: (code: string) => void;
  /**
   * "Màn hình mở rộng" (CB Help) toggle — 2026-09-15 field request: this
   * button used to live only in `DesktopCaptureView`'s own toolbar
   * (`FaceCaptureApp.tsx`'s `modeButton`), which does not render at all
   * while this screen is showing (Bước 2 is a separate, fully-opaque
   * full-screen step, not an overlay on top of the capture view — see this
   * file's own top doc comment on that 2026-09-14 redesign), so the button
   * was simply unreachable during check-in despite an earlier comment
   * elsewhere insisting it stay "always available". `undefined` skips
   * rendering it, same convention as `onManualSubmit` — `FaceCaptureApp.tsx`
   * only passes a real handler on the desktop build where the toggle bridge
   * (`window.faceAPI.toggleCbHelpWindow`) actually exists.
   */
  onToggleCbHelp?: () => void;
  /** Current open/closed state of the CB Help window, for the button's own label/icon — meaningless (and unused) when `onToggleCbHelp` is undefined. */
  cbHelpOpen?: boolean;
}

export function CccdScanWaitingScreen({
  submitting,
  error,
  onScanResult,
  onManualSubmit,
  onToggleCbHelp,
  cbHelpOpen,
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
      <div className="shrink-0 flex items-start justify-between gap-4 px-8 pt-6 pb-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-kiosk-accent">Bước 2</div>
          <h1 className="text-2xl font-bold">Check-in &amp; đối soát hồ sơ</h1>
        </div>
        {onToggleCbHelp && (
          <Button type="button" variant="outline" size="sm" onClick={onToggleCbHelp} className="shrink-0 gap-1.5">
            <Monitor className="h-3.5 w-3.5" />
            {cbHelpOpen ? 'Đóng màn hình mở rộng' : 'Mở màn hình mở rộng'}
          </Button>
        )}
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
              <ScanMonitorCorner
                paused={submitting}
                onScanResult={handleScanResult}
                // 2026-09-18 — a bare (non-CCCD) QR, e.g. a student ID
                // card, reuses the exact same handler a manually-typed
                // submission already calls (`onManualSubmit`'s own doc
                // comment explains why that's already wired for the
                // campaign+login kiosk path) — see `ScanMonitorCorner`'s
                // own `onStudentCodeScan` doc comment for the detection
                // mechanism itself.
                onStudentCodeScan={onManualSubmit}
              />
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

/** How long the hidden scanner input can sit with no new character before whatever it's accumulated is treated as one complete scan and auto-submitted — see `handleScannerInput`'s own doc comment for why this scanner needs this at all (it never sends `Enter`). Long enough to never fire mid-scan (Unicode-composition pauses included), short enough that two separate physical scans are never merged into one. */
const SCAN_DEBOUNCE_MS = 500;
/** How long a clean scan's parsed number stays visible before the roster lookup fires — an operator glance-check, not a blocking gate. */
const STABLE_DISPLAY_MS = 400;
/** How long the found/not-found flash stays up before the corner resumes listening for the next student. */
const SUCCESS_DISPLAY_MS = 1800;

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
 * — only the first field is ever used to identify the person (matching, not
 * display; the roster lookup already returns the subject's real name/class/
 * major once matched).
 *
 * Also validates the SECOND field's shape (số CMND cũ: short, digits-only,
 * or blank), not just the first — 2026-09-15, round 5 field failure: a real
 * corrupted buffer had a first field that still LOOKED like a clean
 * 12-digit id (so an earlier version of this check, which only looked at
 * the first field, accepted it), immediately followed by a field that was
 * 19 digits long — nowhere close to a real CMND number, and itself strong
 * evidence that the id/CMND boundary this found was bogus: most likely 1-2
 * real digits from the true id got pushed past the first "|" by a corrupted
 * read and landed inside what then looked like an oversized field 2.
 * Cross-checking field 2's shape catches that whole class of corruption
 * without needing to special-case any one observed pattern, and rejecting
 * it here means a bad read fails safely (falls through to "Đọc thẻ không
 * thành công, vui lòng quét lại") instead of silently recording a wrong id
 * — the same priority `COMPLETE_CCCD_FIELD_PATTERN` (the instant per-
 * keystroke check, below) and `recoverCitizenIdFromSettledBuffer` (the
 * debounce fallback's own recovery search) both apply the identical
 * two-field validation for the same reason.
 */
export function extractCitizenIdFromQrPayload(raw: string): string | null {
  const match = /^(\d{12})\|\d{0,9}\|/.exec(raw);
  return match ? match[1] : null;
}

/**
 * Fallback recovery used only by `processScanBuffer`'s debounce path (buffer
 * has gone fully quiet), never the instant per-keystroke check. 2026-09-15
 * round 4 field report, decoded from a `[ScanMonitorCorner] scan parse
 * failed` diagnostic: the buffer's first field was garbage that was NEITHER
 * digits nor the true start of the payload (structurally, the tail of an
 * unrelated later field) — consistent with this corner's hidden input
 * losing the first several characters of a scan to a focus race right as it
 * (re)mounts for a new student, before the scanner starts transmitting.
 * Because this scanner keeps re-transmitting the SAME payload for as long
 * as the card stays in view (see `COMPLETE_CCCD_FIELD_PATTERN`'s own doc
 * comment), a complete, uncorrupted repetition typically still follows
 * later in the same buffer — `extractCitizenIdFromQrPayload` alone can never
 * find it, since it only ever looks at the first field.
 *
 * Searches the WHOLE buffer for every `<12 digits>|<0-9 digits>|` occurrence
 * — same two-field validation as `extractCitizenIdFromQrPayload`'s own doc
 * comment explains, required here too: an unvalidated `<12 digits>|` search
 * on its own re-opens exactly the false-positive risk that check exists to
 * close (confirmed by a round 5 failure where the buffer had TWO such
 * matches — the corrupted first field, and a coincidental one hiding
 * inside a field 2 that was really just a longer run of the same digits) —
 * and takes the LAST match, on the theory that later occurrences are more
 * likely to belong to a complete, undamaged repetition than an early one
 * damaged by this same leading-characters-lost issue. This runs only once
 * the buffer has been quiet for `SCAN_DEBOUNCE_MS`, so — unlike the instant
 * per-keystroke check, which is deliberately anchored to buffer position 0
 * to avoid ever silently accepting a wrong-but-plausible match — it is safe
 * to search a buffer that has already fully settled.
 */
function recoverCitizenIdFromSettledBuffer(raw: string): string | null {
  const matches = Array.from(raw.matchAll(/(\d{12})\|\d{0,9}\|/g));
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

/**
 * 2026-09-18 field report, confirmed product decision: a bare 12-digit run
 * with NO pipe anywhere is NOT trusted as a CCCD anymore — a real scan
 * ("006308004439", decoded from this kiosk's own `[ScanDiag]` log) turned
 * out to be a genuine CCCD *value* the campaign's own `eligibilityConfig`
 * (`identity_number` filter) resolves correctly, but the old routing sent
 * it to `lookupCccdByIdentityNumber` instead — the campaign-AGNOSTIC
 * external roster file, which naturally has no idea about it. This used to
 * be `recoverCitizenIdFromSettledBuffer`'s own "fallback of the fallback"
 * (2026-09-15, round 6 field report: "lấy toàn bộ thông tin số đầu tiên
 * khi quét ra là được" — prefer a successful read over strict validation),
 * kept here verbatim in spirit but now feeding `onStudentCodeScan`'s
 * campaign lookup instead of the CCCD path — see `ScanMonitorCorner`'s own
 * `onStudentCodeScan` doc comment for why ANY undelimited code, whatever
 * its length, belongs to the campaign now, not the old roster file.
 * `undefined` unless a real, un-corrupted digit run is at the very end —
 * see `BARE_CODE_REPEAT_PATTERN`'s own doc comment for why a LATER position
 * is trusted over an earlier one in a settled buffer.
 */
export function recoverBareDigitsFromSettledBuffer(raw: string): string | null {
  const tail = raw.slice(-12);
  return /^\d{6,15}$/.test(tail) ? tail : null;
}

/**
 * A student ID card's QR has no delimiter at all — just a bare run of
 * digits (confirmed 2026-09-18: "1777020640", 10 digits) — so there is no
 * `|` to anchor the CCCD checks above on. This scanner's own continuous
 * retransmission (see `COMPLETE_CCCD_FIELD_PATTERN`'s doc comment) is what
 * makes that safe to detect anyway: once the SAME digit run appears twice
 * in a row (`\1` backreference), that is unambiguous proof of one complete,
 * undamaged transmission — no guessing at a fixed length or a "last 12
 * characters" window required.
 *
 * `{6,15}` is a sanity floor/ceiling only, not a CCCD-avoidance bound —
 * 2026-09-18: ANY undelimited code, 12-digit-shaped or not, now routes to
 * the campaign lookup (see this file's own top doc comment on the
 * 2026-09-18 routing decision), so there is no longer a reason to exclude
 * 12 specifically. The floor rules out an accidental short match (e.g. "11"
 * repeating inside noise); the ceiling is generous enough for any real
 * student code or CCCD value. Anchored to `^` for the same reason
 * `COMPLETE_CCCD_FIELD_PATTERN` is: a buffer that has already picked up
 * stray leading noise some other way should fail to match rather than risk
 * finding a coincidental repeat further in and accepting a wrong code with
 * false confidence.
 */
const BARE_CODE_REPEAT_PATTERN = /^(\d{6,15})\1/;

export function extractRepeatingBareCode(raw: string): string | null {
  const match = BARE_CODE_REPEAT_PATTERN.exec(raw);
  return match ? match[1] : null;
}

/**
 * "Trạng thái đầu đọc" status strip — 2026-09-10, replaces the previous
 * bridged-phone-camera + Tesseract OCR corner outright (a dedicated hardware
 * scanner is now required on every kiosk, not an optional/toggleable
 * alternative). 2026-09-14: un-cornered — was a fixed `absolute bottom-6
 * right-6` floating box over a live camera preview; now sits inline in the
 * left column's scan card instead, since the screen around it is no longer
 * a see-through overlay.
 *
 * Every commercial USB/Bluetooth barcode/QR scanner emulates a keyboard by
 * default ("HID keyboard wedge" mode — no driver or SDK needed): scanning a
 * code "types" its decoded contents into whichever element currently has
 * keyboard focus, then sends Enter.
 *
 * 2026-09-15 rewrite — was a `document`-level `keydown` listener manually
 * concatenating `e.key` into a buffer, reset whenever two keystrokes were
 * more than `SCAN_BURST_GAP_MS` (80ms) apart. Field report: scans of a real
 * Vietnamese CCCD's QR (which contains the holder's name/address with
 * diacritics — "Trịnh Thái Sơn", not ASCII) kept failing with "Đọc thẻ
 * không thành công". Root cause: scanners emit a diacritic character via a
 * multi-key OS-level Unicode compose sequence (e.g. Alt+Numpad), not a
 * single clean `keydown` — the intermediate keys can legitimately be spaced
 * more than 80ms apart, which silently wiped `bufferRef` mid-scan, truncating
 * the payload before the CCCD-number prefix a caller actually needs ever
 * reached `Enter`. Manually reconstructing text from raw `keydown.key`
 * values is fundamentally the wrong tool for this: it can never correctly
 * handle whatever Unicode input method the scanner/OS uses.
 *
 * Fix: point the scanner at a real (visually hidden) `<input>` and read its
 * `.value` on `Enter` — the browser's own native text-input pipeline already
 * handles ANY composition method correctly (that's what it's for), so no
 * character-level reconstruction or timing heuristic is needed at all. The
 * input is kept focused whenever nothing else legitimately has focus (see
 * the effect below), so a scan lands there wherever the operator's actual
 * attention is elsewhere on the page — including this same screen's own
 * manual "nhập mã sinh viên" field, which keeps working normally since focus
 * is never stolen while it (or the future QR/VNeID buttons) is in use.
 *
 * `paused` (true while the parent's handling of a previous result —
 * greeting, session start — is still in flight, i.e. `submitting`) stops
 * refocusing the hidden input without unmounting anything, matching the old
 * corner's own pause behaviour so the corner doesn't visibly flicker/reset
 * between one student's scan and the next.
 */
function ScanMonitorCorner({
  paused,
  onScanResult,
  onStudentCodeScan,
}: {
  paused: boolean;
  onScanResult: (result: CccdRosterLookupResult) => void;
  /**
   * 2026-09-18 field report: scanning a student ID card's QR (a bare,
   * un-delimited code — e.g. "1777020640", NOT the pipe-delimited CCCD
   * format `extractCitizenIdFromQrPayload` expects) through this same
   * hidden input produced a DIFFERENT wrong 12-digit value on every
   * attempt ("391777020640", then "401777020640" for the identical card).
   * Root cause, confirmed from this kiosk's own `[ScanDiag]` log: this
   * scanner is continuous-read (see `COMPLETE_CCCD_FIELD_PATTERN`'s own
   * doc comment) — with no pipe to anchor on, the buffer just kept
   * accumulating repeated copies of the same 10-digit code
   * ("17770206401777020640", 20 chars = two repeats), and
   * `recoverCitizenIdFromSettledBuffer`'s `raw.slice(-12)` last-resort
   * fallback grabbed whatever 12-character window happened to straddle the
   * repeat seam — different each time depending on exactly how many
   * repeats had landed before Enter/debounce fired. That fallback is
   * correct for its OWN original case (a genuine CCCD cut short mid-read,
   * never repeating) but actively wrong for a short code that keeps
   * repeating — no 12-character window of a 10-digit-repeated buffer is
   * ever the "real" value.
   *
   * Fix: a bare (no-pipe) run of digits that repeats immediately
   * (`BARE_CODE_REPEAT_PATTERN` below) is unambiguous proof of the true,
   * complete, single code — same anchoring principle
   * `COMPLETE_CCCD_FIELD_PATTERN` already uses for CCCD (stop at the
   * first provably-complete transmission, never guess from a partial or
   * multi-repeat buffer), just without a delimiter to anchor on. Optional:
   * `undefined` (the legacy per-device-secret path, `StudentIdEntryScreen`,
   * has no equivalent bridge) makes this whole detection path inert —
   * see `checkForCompleteMatch`'s own use of it.
   */
  onStudentCodeScan?: (code: string) => void;
}) {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  /** `kind: 'cccd'` goes through the existing local `faceAPI.lookupCccdByIdentityNumber` roster check; `kind: 'student'` (2026-09-18, see `onStudentCodeScan`'s own doc comment) has no local check at all — it hands straight to `onStudentCodeScan`, same as a manually-typed submission, and lets the caller's own lookup (a real API call, not a local file) own the loading state via `paused`. */
  const [stableCode, setStableCode] = useState<{ kind: 'cccd' | 'student'; value: string } | null>(null);

  const scannerInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancels any pending debounce on unmount, so a scan mid-flight when the
  // operator navigates away never fires `processScanBuffer` against an
  // input that's no longer there.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Keeps the hidden scanner input focused so a scan's keystrokes land there
  // no matter where the operator last clicked — but never steals focus away
  // from a REAL input/textarea/contenteditable the operator is actually
  // using (this screen's own manual MSSV field included).
  //
  // `useLayoutEffect`, not `useEffect` (2026-09-15 round 4): this corner
  // unmounts/remounts fresh for every new student (gated by the parent's
  // `awaitingStudent`), and a `[ScanDiag]`-decoded field failure showed the
  // buffer's first several characters missing — consistent with a scan
  // starting (card already presented, scanner already firing) before this
  // effect's very first `refocus()` call had actually run. `useEffect` runs
  // after the browser paints; `useLayoutEffect` runs synchronously right
  // after the DOM commits, closing as much of that window as React allows.
  useLayoutEffect(() => {
    if (paused) return;
    const input = scannerInputRef.current;
    if (!input) return;

    function refocus() {
      const active = document.activeElement as HTMLElement | null;
      // Already focused — do nothing. 2026-09-15 field report: a scan
      // sometimes came through with digits scrambled/duplicated in ways a
      // clean single retransmission could never produce (e.g. the true ID
      // reappearing with extra leading digits and fragments of later fields
      // nested back into earlier ones). Root cause: this function used to
      // call `input.focus()` unconditionally whenever it wasn't some OTHER
      // real input's turn — including every `click`/`focusin` anywhere on
      // the page and every 500ms interval tick — even while `input` already
      // had focus. Calling `.focus()` again on an already-focused element is
      // a no-op for keeping focus, but can still reset the caret to the
      // start; the continuous-read scanner's retransmission gaps are well
      // under that 500ms interval (see `handleScannerInput`'s own doc
      // comment), so this was firing WHILE a scan's keystrokes were still
      // arriving, splicing later characters into the front of the buffer
      // instead of appending them. Returning early here means a scan in
      // progress is never touched.
      if (active === input) return;
      const isOtherRealInput =
        !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!isOtherRealInput) input?.focus({ preventScroll: true });
    }

    refocus();
    document.addEventListener('focusin', refocus);
    document.addEventListener('click', refocus);
    // A periodic nudge covers focus drifting away with no `focusin`/`click`
    // in between (e.g. the window itself losing and regaining OS focus).
    const intervalId = setInterval(refocus, 500);
    return () => {
      document.removeEventListener('focusin', refocus);
      document.removeEventListener('click', refocus);
      clearInterval(intervalId);
    };
  }, [paused]);

  /**
   * Processes whatever the hidden input has accumulated as one complete
   * scan, then clears it. Shared by both the debounce path (below) and a
   * literal `Enter` keydown, so a scanner that DOES send a terminator still
   * submits instantly instead of waiting out the debounce.
   */
  function processScanBuffer(input: HTMLInputElement) {
    const raw = input.value;
    input.value = '';
    if (!raw) return;

    const citizenId = extractCitizenIdFromQrPayload(raw);
    if (citizenId) {
      setStableCode({ kind: 'cccd', value: citizenId });
      setPhase('stable');
      return;
    }

    // Tried BEFORE `recoverCitizenIdFromSettledBuffer`'s own last-resort
    // `slice(-12)` guess — 2026-09-18 field report: that guess is unsafe for
    // a bare, un-delimited code that keeps repeating (see
    // `BARE_CODE_REPEAT_PATTERN`'s own doc comment for the full mechanism).
    // A confirmed repeat is strictly better evidence than an arbitrary tail
    // window, so it always wins when both would otherwise apply.
    const studentCode = onStudentCodeScan ? extractRepeatingBareCode(raw) : null;
    if (studentCode) {
      setStableCode({ kind: 'student', value: studentCode });
      setPhase('stable');
      return;
    }

    const recoveredCitizenId = recoverCitizenIdFromSettledBuffer(raw);
    if (recoveredCitizenId) {
      setStableCode({ kind: 'cccd', value: recoveredCitizenId });
      setPhase('stable');
      return;
    }

    // Last resort — see `recoverBareDigitsFromSettledBuffer`'s own doc
    // comment for the 2026-09-18 routing decision this implements: a bare
    // digit run with no pipe ANYWHERE in the buffer is no longer assumed to
    // be a CCCD just because it happens to be 12 digits long. It goes to
    // the campaign's own lookup instead, same as every other undelimited
    // code shape above.
    const recoveredBareCode = onStudentCodeScan ? recoverBareDigitsFromSettledBuffer(raw) : null;
    if (recoveredBareCode) {
      setStableCode({ kind: 'student', value: recoveredBareCode });
      setPhase('stable');
      return;
    }

    // TEMP DIAGNOSTIC (2026-09-15) — remove once the scan-failure root
    // cause is confirmed. Reveals exactly what the hidden input actually
    // received (length + char codes of the first 20 chars) so a
    // stray/invisible character or an unexpected split can be told apart
    // from "the scanner just isn't reaching this input at all". A SINGLE
    // string argument, not a message + object — Electron's
    // `console-message` forwarding to the main process only carries a
    // renderer console call's first string argument (see the identical
    // note on `openFrameStreams`'s own diagnostic log in
    // FaceCaptureApp.tsx), so a second object argument here would just
    // show up as "[object Object]" instead of anything useful.
    console.warn(
      `[ScanMonitorCorner] scan parse failed ${JSON.stringify({
        length: raw.length,
        first20CharCodes: Array.from(raw.slice(0, 20)).map((c) => c.charCodeAt(0)),
        firstFieldRaw: raw.split('|')[0] ?? '',
      })}`
    );
    setStatusText('Đọc thẻ không thành công, vui lòng quét lại.');
  }

  /**
   * 2026-09-15 field diagnosis, round 2: the debounce fix below alone was
   * NOT enough — this specific scanner is a continuous-read model that keeps
   * re-decoding and re-"typing" the SAME payload over and over while the
   * card stays in view, with gaps between successive full retransmissions
   * well under `SCAN_DEBOUNCE_MS`. Confirmed from a second real failure's
   * captured buffer: a clean seam where one full payload's tail directly
   * abuts the NEXT retransmission's head — the debounce never once found
   * 500ms of true silence to fire on, so the buffer just kept growing
   * across multiple retransmissions instead of one.
   *
   * Fix: stop waiting for silence at all. `COMPLETE_CCCD_FIELD_PATTERN`
   * checks after EVERY character whether a complete first field (12 digits
   * immediately followed by the next field's `|`) has appeared anywhere in
   * the buffer — the instant the FIRST full transmission finishes, this
   * matches and the scan is accepted right then, before a second
   * retransmission ever has a chance to start concatenating onto it. The
   * debounce (`handleScannerInput`'s original purpose, still below) is kept
   * only as a fallback for a garbled/partial read that never forms a clean
   * match — that case still needs *some* way to eventually give up and show
   * "Đọc thẻ không thành công" instead of waiting forever.
   *
   * Anchored to `^` (2026-09-15, alongside the `refocus()` fix above that
   * addresses the actual root cause of a corrupted buffer): if the buffer
   * ever DOES pick up stray leading characters some other way this hasn't
   * anticipated, an unanchored match could still find a plausible-looking
   * but WRONG 12-digit run further into the buffer and silently accept it
   * as if it were a clean read — the worst outcome here, a wrong citizen ID
   * recorded as a confident match. Anchoring means a corrupted buffer just
   * fails to match at all and falls through to the debounce fallback's
   * honest "Đọc thẻ không thành công, vui lòng quét lại", which is always
   * safer than a silent wrong answer.
   *
   * Also requires the SECOND field's shape (round 5, `extractCitizenId
   * FromQrPayload`'s own doc comment explains why) — a real failure showed
   * the anchor alone isn't enough on its own: a corrupted first field can
   * still coincidentally be exactly 12 digits (the length survives even
   * when the CONTENT is shifted/wrong), which this catches by also
   * requiring what follows to look like a real, short số-CMND-cũ field.
   */
  const COMPLETE_CCCD_FIELD_PATTERN = /^(\d{12})\|\d{0,9}\|/;

  /**
   * TEMP DIAGNOSTIC (2026-09-15, round 4) — the two previous fixes (skip
   * redundant `refocus()` calls; anchor the match pattern to `^`) did NOT
   * resolve the field report: a real scan still comes back with the wrong
   * citizen id, corrupted in the same shape as before (extra/missing digits
   * near the start, name/date/address fields interleaved with fragments of
   * themselves). Guessing a third mechanism blind isn't productive — this
   * logs the RAW event sequence (keydown/composition/input, each with only
   * numeric char codes or lengths, never the actual decoded text — see
   * `processScanBuffer`'s own `first20CharCodes` for the same
   * privacy-preserving precedent) so the next real failure can be diagnosed
   * from actual evidence instead of another guess. Remove once resolved.
   * Single-string-argument `console.warn` throughout — see this file's
   * existing note on why (Electron's console-forwarding drops a 2nd arg).
   */
  function diagLog(event: string, extra: Record<string, unknown> = {}) {
    console.warn(`[ScanDiag] ${JSON.stringify({ t: Math.round(performance.now()), event, ...extra })}`);
  }

  /**
   * Shared by the plain `input` path below and `handleScannerComposition
   * End` — factored out so a composed (IME) character's final commit gets
   * exactly the same match-or-arm-debounce treatment as a normal keystroke,
   * instead of only checking on non-composition `input` events and missing
   * whatever changed during composition.
   */
  function checkForCompleteMatch(input: HTMLInputElement) {
    const match = COMPLETE_CCCD_FIELD_PATTERN.exec(input.value);
    if (match) {
      diagLog('match', { valueLen: input.value.length });
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      input.value = '';
      setStableCode({ kind: 'cccd', value: match[1] });
      setPhase('stable');
      return true;
    }

    // Same "stop at the first provably-complete transmission" principle as
    // the CCCD branch above, for a bare (no-pipe) code instead — see
    // `BARE_CODE_REPEAT_PATTERN`'s own doc comment. Checked instantly, not
    // only in the debounce fallback, for the same reason: waiting for
    // silence risks a THIRD repeat piling onto the buffer before it ever
    // goes quiet (this scanner's retransmission gaps run well under
    // `SCAN_DEBOUNCE_MS`).
    if (onStudentCodeScan) {
      const studentCode = extractRepeatingBareCode(input.value);
      if (studentCode) {
        diagLog('match-student-code', { valueLen: input.value.length });
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        input.value = '';
        setStableCode({ kind: 'student', value: studentCode });
        setPhase('stable');
        return true;
      }
    }

    // Fallback path — see this function's own doc comment above. Once
    // `SCAN_DEBOUNCE_MS` passes with no further characters AND no clean
    // field match ever appeared, treat whatever accumulated as a failed
    // scan (`processScanBuffer` reports it via the usual error message).
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      processScanBuffer(input);
    }, SCAN_DEBOUNCE_MS);
    return false;
  }

  /**
   * Tracks whether the hidden input is mid-IME-composition (e.g. a diacritic
   * assembled over several OS-level key events) — 2026-09-15 round 4
   * hypothesis: programmatically reading/clearing `.value` while a
   * composition is still open is a well-known way to desync the browser's
   * composition state from the actual DOM value, which can itself produce
   * corrupted/duplicated text once the IME tries to keep composing on top of
   * a value it no longer recognizes. While this is true, pattern-matching is
   * skipped entirely (deferred to `onCompositionEnd`) so we never clear
   * `.value` mid-composition.
   */
  const isComposingRef = useRef(false);

  function handleScannerInput(e: React.FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const nativeEvent = e.nativeEvent as InputEvent;
    const composing = nativeEvent.isComposing === true || isComposingRef.current;
    diagLog('input', {
      isComposing: composing,
      valueLen: input.value.length,
      lastCharCode: input.value.length > 0 ? input.value.charCodeAt(input.value.length - 1) : null,
      inputType: nativeEvent.inputType ?? null,
    });
    if (composing) return; // handled by onCompositionEnd instead
    checkForCompleteMatch(input);
  }

  function handleScannerCompositionStart() {
    isComposingRef.current = true;
    diagLog('compositionstart');
  }

  function handleScannerCompositionEnd(e: React.CompositionEvent<HTMLInputElement>) {
    isComposingRef.current = false;
    diagLog('compositionend', { dataLen: e.data?.length ?? 0 });
    checkForCompleteMatch(e.currentTarget);
  }

  function handleScannerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Diagnostic only: single printable characters are logged as a numeric
    // char code (never the literal character) so this can be shared safely;
    // multi-character key names (Enter, Alt, Shift, Unidentified, …) carry
    // no scan content and are logged as-is.
    diagLog('keydown', {
      key: e.key.length === 1 ? e.key.charCodeAt(0) : e.key,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      isComposing: (e.nativeEvent as KeyboardEvent).isComposing,
    });
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    processScanBuffer(e.currentTarget);
  }

  // Clean read -> brief glance window -> roster lookup. Same "auto-confirm,
  // shown briefly for a glance, not a blocking tap" product decision the
  // OCR path already made — no per-read stability streak needed here (a
  // scanner decode is an exact read, not a noisy repeated guess).
  useEffect(() => {
    if (phase !== 'stable' || !stableCode) return;
    const code = stableCode;

    // Clears the buffer once a retransmitting card's card is pulled away
    // mid-cycle — see the CCCD branch's own long-standing comment on this
    // exact race, below. Shared by both branches (2026-09-18) since the
    // scanner's retransmission behavior is identical either way.
    function clearLeftoverBuffer() {
      if (scannerInputRef.current) scannerInputRef.current.value = '';
    }

    if (code.kind === 'student') {
      // 2026-09-18 — no local check to run here at all (unlike CCCD, which
      // checks the campaign-agnostic roster file via `faceAPI` before
      // deciding found/not-found): `onStudentCodeScan` hands the code
      // straight to the SAME handler a manually-typed submission already
      // uses, which does its own real (campaign-scoped) API lookup and owns
      // its own loading/error state via `paused` — see `onStudentCodeScan`'s
      // own doc comment. This corner's job ends at "reliably extracted a
      // complete code," so it returns to idle right after handing off
      // rather than tracking a found/not-found phase it has no way to know.
      const timer = setTimeout(() => {
        onStudentCodeScan?.(code.value);
        setStableCode(null);
        setStatusText(null);
        setPhase('idle');
        clearLeftoverBuffer();
      }, STABLE_DISPLAY_MS);
      return () => clearTimeout(timer);
    }

    const citizenId = code.value;
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
            setStableCode(null);
            setStatusText(null);
            setPhase('idle');
            // 2026-09-15 round 4: this scanner keeps re-transmitting the
            // same payload for as long as the card sits in view (see
            // `COMPLETE_CCCD_FIELD_PATTERN`'s own doc comment) — if the
            // operator pulls the card away mid-retransmission right as this
            // fires, whatever partial tail the scanner had queued can still
            // land in the input a moment later. Clearing here means that
            // tail lands in an EMPTY buffer instead of silently prefixing
            // the NEXT student's card — a plausible source of "wrong data"
            // that neither of the previous two fixes addressed, since both
            // were about a single scan's own internal handling, not
            // leftovers crossing into the next one.
            clearLeftoverBuffer();
          }, SUCCESS_DISPLAY_MS);
        })
        .catch((err: unknown) => {
          setStatusText(err instanceof Error ? err.message : String(err));
          setPhase('check-error');
        });
    }, STABLE_DISPLAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stableCode]);

  function retryAfterCheckError() {
    setStableCode(null);
    setStatusText(null);
    setPhase('idle');
    if (scannerInputRef.current) scannerInputRef.current.value = '';
  }

  return (
    <div className="flex w-full items-center justify-center gap-2 border-t border-kiosk-border pt-3">
      {/*
        Visually hidden but real+focusable, so the OS/browser's own text
        pipeline composes whatever Unicode input method the scanner emulates
        — see this component's own doc comment for why a raw `keydown`
        listener could not. `aria-hidden` + `tabIndex={-1}` keep it out of
        the accessibility tree and manual Tab order; it is still focused
        programmatically by the effect above.
      */}
      <input
        ref={scannerInputRef}
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        onInput={handleScannerInput}
        onKeyDown={handleScannerKeyDown}
        onCompositionStart={handleScannerCompositionStart}
        onCompositionEnd={handleScannerCompositionEnd}
        className="absolute h-0 w-0 overflow-hidden opacity-0"
      />
      <span className="text-xs text-kiosk-text-muted">Trạng thái đầu đọc:</span>
      {phase === 'idle' && !statusText && <Badge variant="neutral">Sẵn sàng</Badge>}
      {phase === 'stable' && stableCode && <Badge variant="info">{stableCode.value}</Badge>}
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
