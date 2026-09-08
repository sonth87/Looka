import { useState, type FormEvent } from 'react';

/**
 * Pre-session "nhập mã sinh viên" overlay (2026-09-07 product request) —
 * shown before every capture session, including automatically again after
 * one finishes (see `FaceCaptureApp.tsx`'s `SessionReviewModal.onAccept`),
 * so the kiosk behaves as a walk-up loop: one student's session ends, the
 * kiosk falls straight back to this screen for the next one.
 *
 * Same visual layering as the `deviceBlockedReason` overlay in
 * `FaceCaptureApp.tsx` (full-screen `absolute inset-0`), but interactive and
 * one z-index below it (`z-[150]` vs `z-[200]`) — a blocked device must
 * still win if both were ever true at once.
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
    <div className="absolute inset-0 z-[150] bg-slate-950/98 flex flex-col items-center justify-center gap-6 px-8 text-center">
      <span className="text-5xl">🎓</span>
      <h2 className="text-2xl font-semibold">Nhập mã sinh viên</h2>
      <p className="max-w-md text-sm text-slate-300">
        Vui lòng nhập mã sinh viên để bắt đầu phiên chụp.
      </p>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col items-center gap-3">
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Mã sinh viên"
          disabled={submitting}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center text-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
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
        <div className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
