import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { StudentProfileCard } from './StudentProfileCard.js';

/**
 * Full-screen "BƯỚC 2: CHECK-IN & ĐỐI SOÁT HỒ SƠ" step (ui-redesign-plan.md,
 * "Bước 4 — Check-in & đối soát hồ sơ" — mockup #5), 2026-09-14 restyle, for
 * the non-kiosk/legacy build (`apps/web`, or the legacy per-device-secret
 * desktop path) — see `CccdScanWaitingScreen.tsx`'s own doc comment for why
 * the kiosk's campaign+login path uses that component instead. Neither build
 * has a CCCD scanner attached, so this screen's left column only ever offers
 * the manual "nhập mã sinh viên" form — no QR/VNeID quick-link stubs here
 * (unlike `CccdScanWaitingScreen`'s left column), since there is no
 * alternative input method to fall back to on this build at all.
 *
 * Was previously a translucent `absolute inset-0 pointer-events-none`
 * overlay anchored at the bottom of the screen, letting a live camera
 * preview show through behind it — see git history for that version if it's
 * ever needed for reference. This is now a fully opaque, full-bleed 2-column
 * step screen instead, matching `CccdScanWaitingScreen.tsx`'s new layout.
 * Mounted inside the shared `KioskShell`'s content area by
 * `FaceCaptureApp.tsx` (unchanged `awaitingStudent` gating), so it does not
 * draw its own header/clock/brand bar.
 *
 * Shown before every capture session, including automatically again after
 * one finishes (see `FaceCaptureApp.tsx`'s `SessionReviewModal.onAccept`),
 * so the kiosk behaves as a walk-up loop: one student's session ends, the
 * kiosk falls straight back to this screen for the next one.
 *
 * Right column: unlike `CccdScanWaitingScreen`, this screen can never show a
 * matched student's profile — `onSubmit` below is a plain `(code: string) =>
 * void`, so no lookup result is ever threaded back down to this component
 * (the lookup and everything after it happens entirely in
 * `FaceCaptureApp.tsx`). Shown honestly as a waiting placeholder at all
 * times rather than faking a result.
 */
export interface StudentIdEntryScreenProps {
  onSubmit: (code: string) => void;
  /** True while `lookupStudent()` is in flight, or during the post-FOUND greeting wait — the form stays disabled through both. */
  submitting: boolean;
  /** Set by the caller on a NOT_FOUND result; cleared on the next submit attempt. */
  error: string | null;
}

export function StudentIdEntryScreen({ onSubmit, submitting, error }: StudentIdEntryScreenProps) {
  const [code, setCode] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    onSubmit(trimmed);
  };

  return (
    <div className="absolute inset-0 z-[150] flex flex-col overflow-y-auto bg-kiosk-bg text-kiosk-text">
      <div className="shrink-0 px-8 pt-6 pb-2">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-kiosk-accent">Bước 2</div>
        <h1 className="text-2xl font-bold">Check-in &amp; đối soát hồ sơ</h1>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-2">
        {/* Left column — manual lookup, the only method this build has */}
        <div className="flex flex-col gap-4">
          <Card variant="panel">
            <CardHeader>
              <CardTitle>Nhập mã sinh viên</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 text-center">
              <span className="text-4xl" aria-hidden>
                🎓
              </span>
              <p className="text-sm text-kiosk-text-muted">
                Vui lòng nhập mã sinh viên để bắt đầu phiên chụp.
              </p>
              <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-3">
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Mã sinh viên"
                  disabled={submitting}
                  className="w-full rounded-lg border border-kiosk-border bg-kiosk-surface-2 px-4 py-3 text-center text-lg text-kiosk-text placeholder:text-kiosk-text-muted focus:outline-none focus:ring-2 focus:ring-kiosk-accent/60 disabled:opacity-50"
                />
                <Button type="submit" size="lg" className="w-full" disabled={submitting || !code.trim()}>
                  {submitting ? 'Đang xử lý...' : 'Xác nhận'}
                </Button>
              </form>
              {error && (
                <div className="w-full rounded-lg border border-kiosk-danger/40 bg-kiosk-danger/10 px-4 py-3 text-sm text-kiosk-danger">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column — no lookup result ever reaches this component (see doc comment above), so always the waiting state */}
        <div className="flex flex-col">
          <StudentProfileCard
            subject={null}
            waitingMessage={submitting ? 'Đang tra cứu hồ sơ…' : 'Đang chờ nhập mã sinh viên…'}
          />
        </div>
      </div>
    </div>
  );
}
