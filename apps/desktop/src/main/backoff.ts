/**
 * Exponential backoff with reset — shared by `tetheredCameraWatcher.ts`
 * (auto-detect polling) and `tetheredCamera.ts`'s `ensureMovieStream()`
 * (docs/plans/canon-auto-detect-polling-plan-2026-09-24.md Bước 5): both
 * need "retry with a growing delay after failure, reset to the base delay
 * after success" — kept as one small shared helper instead of two
 * near-identical copies.
 */
export interface Backoff {
  /** Delay to wait before the next attempt; grows the internal delay for next time (capped at `maxMs`). */
  next(): number;
  /** Back to the base delay — call after a successful attempt. */
  reset(): void;
}

export function createBackoff(baseMs: number, maxMs: number): Backoff {
  let delay = baseMs;
  return {
    next(): number {
      const current = delay;
      delay = Math.min(delay * 2, maxMs);
      return current;
    },
    reset(): void {
      delay = baseMs;
    },
  };
}
