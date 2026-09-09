import { useState, type FormEvent } from 'react';

/**
 * Pre-session "nhập mã sinh viên" overlay (2026-09-07 product request) —
 * shown before every capture session, including automatically again after
 * one finishes (see `FaceCaptureApp.tsx`'s `SessionReviewModal.onAccept`),
 * so the kiosk behaves as a walk-up loop: one student's session ends, the
 * kiosk falls straight back to this screen for the next one.
 *
 * Same footprint as the `deviceBlockedReason` overlay in `FaceCaptureApp.tsx`
 * (full-screen `absolute inset-0`), one z-index below it (`z-[150]` vs
 * `z-[200]`) — a blocked device must still win if both were ever true at
 * once. Unlike that overlay, the background here is translucent
 * (2026-09-08 product feedback): the live camera preview underneath must
 * stay visible while a student's code is being entered, both so the
 * operator can already see whether the next person is framed correctly and
 * so the screen doesn't look "frozen" during the walk-up loop's idle wait.
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
    <div className="absolute inset-0 z-[150] flex flex-col items-center justify-end pb-16 px-8 text-center pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-950/70 backdrop-blur-md px-6 py-6 shadow-2xl">
        <span className="text-4xl">🎓</span>
        <h2 className="text-xl font-semibold">Nhập mã sinh viên</h2>
        <p className="text-sm text-slate-300">Vui lòng nhập mã sinh viên để bắt đầu phiên chụp.</p>
        <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-3">
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Mã sinh viên"
            disabled={submitting}
            className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-3 text-center text-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || !code.trim()}
            className="w-full rounded-lg bg-sky-600 py-3 text-base font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
        </form>
        {error && (
          <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
