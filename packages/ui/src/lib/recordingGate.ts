/**
 * Pure gating + cap logic for the two video-recording effects in
 * FaceCaptureApp.tsx (§3.1, docs/plans/multi-camera-device-management-discussion.md).
 * Extracted so "should a recorder be running right now" and "has this
 * recording overrun its runaway cap" are unit-testable without a DOM,
 * `MediaRecorder`, or React — see `__tests__/recordingGate.test.ts`.
 *
 * Field bug this exists to prevent (2026-09-05, Windows kiosk, 3-camera
 * simultaneous campaign, `recordVideo=true`): a session started, the
 * operator abandoned it with no cancel/complete ever firing, and the
 * recorders kept running — two `capture_streams` rows were eventually
 * closed at ~234 MB each and one was left OPEN (`size_bytes=0`,
 * `ended_at=null`). The *next* real session then created NO recording rows
 * at all. Root cause: both recording effects were gated on a plain
 * `recordVideo && isRecordingSession` boolean. `isRecordingSession` was
 * still `true` from the abandoned run (nothing had reset it — there was no
 * idle/runaway cap at all), so the next session's `setIsRecordingSession(true)`
 * was a no-op (same value in, no re-render), the effects never re-ran, and
 * the stale recorder from the abandoned run just kept recording whatever it
 * already had open while the new session got no recorder of its own.
 *
 * Fix: key the gate on the engine's actual session id
 * (`recordingSessionKey`), not a boolean. A brand-new session always has a
 * genuinely different id, so the effects' dependency arrays always change
 * and always restart — even if the previous session's teardown never ran —
 * and a runaway cap (`isRecordingOverCap`) guarantees a session with no
 * operator action at all still gets its recording stopped and finalized
 * after `MAX_RECORDING_DURATION_MS`.
 */

/** Inputs shared by both recording effects' gating decision. */
export interface RecordingGateInputs {
  /** Campaign's "Quay video trong lúc chụp" switch — false means never record, regardless of everything else. */
  recordVideo: boolean;
  /**
   * The active engine session's id, captured once at real session start
   * (`recordingSessionKey` state in FaceCaptureApp) — `null` whenever no
   * real (operator-started) session is currently open. See this file's own
   * doc comment for why keying on the id itself, not a boolean, is the fix.
   */
  recordingSessionKey: string | null;
  /**
   * Number of distinct physical cameras mapped to CENTER/LEFT/RIGHT/UP/DOWN
   * — decides which of the two recording effects applies (see
   * `multiChannelDeviceIds`' own doc comment in FaceCaptureApp.tsx).
   */
  multiChannelDeviceCount: number;
}

/**
 * Gate for the single-stream (fallback) recording effect — active only
 * while fewer than 2 physical cameras are mapped to roles, so it never
 * double-records alongside the multi-channel effect below.
 */
export function shouldRecordSingleStream(
  inputs: RecordingGateInputs & { hasStream: boolean }
): boolean {
  return (
    inputs.recordVideo &&
    inputs.recordingSessionKey !== null &&
    inputs.hasStream &&
    inputs.multiChannelDeviceCount < 2
  );
}

/**
 * Gate for the true simultaneous multi-channel recording effect — active
 * once at least 2 distinct physical cameras are mapped to roles.
 */
export function shouldRecordMultiChannel(inputs: RecordingGateInputs): boolean {
  return (
    inputs.recordVideo &&
    inputs.recordingSessionKey !== null &&
    inputs.multiChannelDeviceCount >= 2
  );
}

/**
 * Runaway-recording cap: a session with no operator action at all (no
 * cancel, no completion, no restart — the exact 2026-09-05 field scenario)
 * must not record forever. Ten minutes comfortably covers every real
 * 5-frame capture session (seconds, not minutes) while bounding the damage
 * of a kiosk left abandoned mid-session overnight.
 */
export const MAX_RECORDING_DURATION_MS = 10 * 60 * 1000;

/** Whether a recording that started at `startedAt` has now run past the cap. */
export function isRecordingOverCap(startedAt: number, now: number = Date.now()): boolean {
  return now - startedAt >= MAX_RECORDING_DURATION_MS;
}
