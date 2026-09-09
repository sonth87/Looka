/**
 * Pure byte-liveness state machine for the two `MediaRecorder`-based
 * recording effects in FaceCaptureApp.tsx (discussion doc §3.10, "Ghi hình
 * phải chắc chắn hoạt động khi được chọn" — layer 2, "Trong phiên").
 *
 * Before this existed, `MediaRecorder.start()` was called with no
 * `timeslice` argument at all, so `ondataavailable` only ever fired once, at
 * `stop()` — meaning the whole recording lived in RAM until the session
 * ended and there was no way to tell, *during* a session, whether a
 * recorder had silently stopped producing bytes (the exact historical bug:
 * kiosk `capture_streams` rows with `size_bytes=0`, `ended_at=null`, the
 * recorder having wedged with nothing downstream ever finding out). Passing
 * `RECORDING_TIMESLICE_MS` makes `ondataavailable` fire on a schedule, which
 * is what this module turns into a liveness signal:
 *
 *   - no data for `RECORDING_STALE_MS` (default 3s) -> attempt exactly one
 *     automatic recorder restart (stop the wedged recorder, start a fresh
 *     one on the same `MediaStream`, same timeslice — done by the caller,
 *     this module only decides *when*);
 *   - still no data for another `RECORDING_STALE_MS` after that -> give up
 *     and report `FAILED`, so the caller can surface "Video <role> không
 *     ghi được" (ui-redesign-plan.md S5) without interrupting the session
 *     itself (Q23: the session keeps running, S6 blocks confirmation later).
 *
 * Deliberately has no knowledge of `MediaRecorder`, timers, or React state —
 * every transition takes `now` as a plain number, so `__tests__/recordingLiveness.test.ts`
 * drives it without a DOM or fake timers, mirroring `recordingGate.ts`'s
 * existing "gate logic is pure, the effect is glue" split.
 */

/** Default gap (ms) with zero bytes received before this module reacts. */
export const RECORDING_STALE_MS = 3000;

/** `MediaRecorder.start(timeslice)` value both recording effects pass — see this file's own header comment for why this must be set at all. */
export const RECORDING_TIMESLICE_MS = 1000;

/** How often the caller should poll `checkRecordingLiveness` while a recorder is active. */
export const RECORDING_LIVENESS_CHECK_INTERVAL_MS = 1000;

export type RecordingLivenessStatus = 'ACTIVE' | 'FAILED';

export interface RecordingLivenessState {
  status: RecordingLivenessStatus;
  /** `now` at the most recent `recordLivenessData` call (or the state's creation, if none yet). */
  lastDataAt: number;
  /** Whether the one-shot automatic restart has already been used. */
  restarted: boolean;
  /** Running total, purely for a caller-facing "x,x MB" readout — never read by this module's own decisions. */
  bytesReceived: number;
}

export function createRecordingLivenessState(now: number): RecordingLivenessState {
  return { status: 'ACTIVE', lastDataAt: now, restarted: false, bytesReceived: 0 };
}

/** Call whenever `ondataavailable` fires with `event.data.size > 0`. */
export function recordLivenessData(
  state: RecordingLivenessState,
  bytes: number,
  now: number
): RecordingLivenessState {
  return {
    ...state,
    lastDataAt: now,
    bytesReceived: state.bytesReceived + bytes,
    // Data flowing again after a FAILED verdict is still worth taking —
    // more video is strictly better than less — but the session was already
    // flagged and stays flagged: `status` does not un-fail itself here. A
    // caller that wants "recovered" semantics can inspect
    // `bytesReceived`/`lastDataAt` itself; this module only ever escalates.
    status: state.status,
  };
}

export type RecordingLivenessAction = 'NONE' | 'RESTART' | 'FAIL';

export interface RecordingLivenessCheckResult {
  state: RecordingLivenessState;
  action: RecordingLivenessAction;
}

/**
 * Call periodically (every `RECORDING_LIVENESS_CHECK_INTERVAL_MS`, say)
 * while a recorder should be actively producing data. Returns the possibly
 * updated state plus what the caller should do:
 *
 *   - `'NONE'`: still within `staleAfterMs` of the last real data (or
 *     already `FAILED` — no point escalating twice).
 *   - `'RESTART'`: first time the gap crossed `staleAfterMs` — caller should
 *     stop the current `MediaRecorder` and start a fresh one on the same
 *     stream, then keep calling this on the same (returned) state so the
 *     *next* stale window is judged from this moment, not the original one.
 *   - `'FAIL'`: the gap crossed `staleAfterMs` again after a restart was
 *     already attempted — caller should mark this channel failed
 *     (`recordingFailed`) and surface it; the recorder can keep running
 *     (more video is still better than none — Q23 leaves the session itself
 *     running and only blocks confirmation later, at S6).
 */
export function checkRecordingLiveness(
  state: RecordingLivenessState,
  now: number,
  staleAfterMs: number = RECORDING_STALE_MS
): RecordingLivenessCheckResult {
  if (state.status === 'FAILED') return { state, action: 'NONE' };

  const gap = now - state.lastDataAt;
  if (gap < staleAfterMs) return { state, action: 'NONE' };

  if (!state.restarted) {
    // Reset the clock to `now`: the caller is about to start a brand-new
    // recorder, and its own first `ondataavailable` is naturally up to one
    // timeslice away — counting from the original stale instant would give
    // it less than a full `staleAfterMs` window to prove itself.
    return { state: { ...state, restarted: true, lastDataAt: now }, action: 'RESTART' };
  }

  return { state: { ...state, status: 'FAILED' }, action: 'FAIL' };
}
