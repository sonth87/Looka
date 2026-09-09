import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecordingLivenessState,
  recordLivenessData,
  checkRecordingLiveness,
  RECORDING_STALE_MS,
  RECORDING_TIMESLICE_MS,
} from '../recordingLiveness.js';

/**
 * Coverage for the byte-liveness state machine backing §3.10 layer 2 ("Trong
 * phiên"): timeslice-driven data flow, one automatic restart after a 3s
 * data gap, and FAILED after a second gap post-restart. These are
 * unit-level, mocked-clock tests of the pure decision logic — not a real
 * `MediaRecorder`/camera, which this environment does not have (see this
 * repo's own recordingGate.test.ts for the same pattern, and
 * FaceCaptureApp.tsx's recording effects for how this module's decisions
 * are actually wired to `MediaRecorder.start()`/`.stop()`).
 */

test('RECORDING_TIMESLICE_MS is 1000ms — the exact "timeslice" value MediaRecorder.start() must be called with', () => {
  assert.equal(RECORDING_TIMESLICE_MS, 1000);
});

test('fresh state stays ACTIVE and produces no action while data keeps arriving inside the stale window', () => {
  let state = createRecordingLivenessState(0);
  state = recordLivenessData(state, 50_000, 900);
  let result = checkRecordingLiveness(state, 1_800); // 900ms since last data < 3000ms
  assert.equal(result.action, 'NONE');
  assert.equal(result.state.status, 'ACTIVE');

  state = recordLivenessData(result.state, 60_000, 2_700);
  result = checkRecordingLiveness(state, 3_500); // 800ms since last data
  assert.equal(result.action, 'NONE');
  assert.equal(result.state.bytesReceived, 110_000);
});

test('a 3s gap with no data triggers exactly one RESTART', () => {
  const state = createRecordingLivenessState(0);
  const result = checkRecordingLiveness(state, RECORDING_STALE_MS); // exactly at the threshold
  assert.equal(result.action, 'RESTART');
  assert.equal(result.state.restarted, true);
  assert.equal(result.state.status, 'ACTIVE', 'a restart is an attempt to recover, not a failure yet');
});

test('a gap under the threshold never restarts', () => {
  const state = createRecordingLivenessState(0);
  const result = checkRecordingLiveness(state, RECORDING_STALE_MS - 1);
  assert.equal(result.action, 'NONE');
  assert.equal(result.state.restarted, false);
});

test('data flowing again after a successful restart clears the gap — no FAIL follows', () => {
  let state = createRecordingLivenessState(0);
  let result = checkRecordingLiveness(state, 3_000);
  assert.equal(result.action, 'RESTART');
  state = result.state;

  // The new recorder (started at t=3000) produces data at t=3500.
  state = recordLivenessData(state, 40_000, 3_500);
  result = checkRecordingLiveness(state, 6_400); // 2900ms since the new data — still under 3000ms
  assert.equal(result.action, 'NONE');
  assert.equal(result.state.status, 'ACTIVE');
});

test('a second 3s gap after the restart marks the channel FAILED', () => {
  let state = createRecordingLivenessState(0);
  let result = checkRecordingLiveness(state, 3_000);
  assert.equal(result.action, 'RESTART');
  state = result.state; // lastDataAt reset to 3000, restarted: true

  // The restarted recorder never produces anything either.
  result = checkRecordingLiveness(state, 3_000 + RECORDING_STALE_MS);
  assert.equal(result.action, 'FAIL');
  assert.equal(result.state.status, 'FAILED');
});

test('once FAILED, further checks are inert (no repeated FAIL actions)', () => {
  let state = createRecordingLivenessState(0);
  state = checkRecordingLiveness(state, 3_000).state; // RESTART
  state = checkRecordingLiveness(state, 6_000).state; // FAIL
  assert.equal(state.status, 'FAILED');

  const later = checkRecordingLiveness(state, 100_000);
  assert.equal(later.action, 'NONE');
  assert.equal(later.state.status, 'FAILED');
});

test('data arriving after FAILED is still counted (more video is better than none) but does not clear the failed flag', () => {
  let state = createRecordingLivenessState(0);
  state = checkRecordingLiveness(state, 3_000).state;
  state = checkRecordingLiveness(state, 6_000).state;
  assert.equal(state.status, 'FAILED');

  state = recordLivenessData(state, 20_000, 10_000);
  assert.equal(state.bytesReceived, 20_000);
  assert.equal(state.status, 'FAILED', 'a channel already reported failed stays failed for this session');
});

test('a custom staleAfterMs is honoured instead of the 3s default', () => {
  const state = createRecordingLivenessState(0);
  const tooEarly = checkRecordingLiveness(state, 500, 1000);
  assert.equal(tooEarly.action, 'NONE');
  const atThreshold = checkRecordingLiveness(state, 1000, 1000);
  assert.equal(atThreshold.action, 'RESTART');
});
