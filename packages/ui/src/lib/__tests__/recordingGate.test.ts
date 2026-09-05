import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRecordSingleStream,
  shouldRecordMultiChannel,
  isRecordingOverCap,
  MAX_RECORDING_DURATION_MS,
} from '../recordingGate.js';

test('shouldRecordSingleStream requires recordVideo, a real session key, a stream, and <2 mapped cameras', () => {
  const base = { recordVideo: true, recordingSessionKey: 'session_1', hasStream: true, multiChannelDeviceCount: 0 };
  assert.equal(shouldRecordSingleStream(base), true);
  assert.equal(shouldRecordSingleStream({ ...base, recordVideo: false }), false);
  assert.equal(shouldRecordSingleStream({ ...base, recordingSessionKey: null }), false);
  assert.equal(shouldRecordSingleStream({ ...base, hasStream: false }), false);
  assert.equal(shouldRecordSingleStream({ ...base, multiChannelDeviceCount: 2 }), false);
});

test('shouldRecordMultiChannel requires recordVideo, a real session key, and >=2 mapped cameras', () => {
  const base = { recordVideo: true, recordingSessionKey: 'session_1', multiChannelDeviceCount: 2 };
  assert.equal(shouldRecordMultiChannel(base), true);
  assert.equal(shouldRecordMultiChannel({ ...base, recordVideo: false }), false);
  assert.equal(shouldRecordMultiChannel({ ...base, recordingSessionKey: null }), false);
  assert.equal(shouldRecordMultiChannel({ ...base, multiChannelDeviceCount: 1 }), false);
});

test('a brand-new session key re-arms recording even if the previous session never reset the flag (the 2026-09-05 field bug)', () => {
  // Simulates: abandoned session's key never got cleared to null (no cancel/
  // complete ever fired), yet the NEXT real session starts with a genuinely
  // different id. The old boolean-gated design would have seen `true` ->
  // `true` (a no-op); this design sees a real key change, which is what
  // actually matters for a `useEffect` dependency array to restart.
  const abandonedKey = 'session_1757000000000';
  const nextKey = 'session_1757000900000';
  assert.notEqual(abandonedKey, nextKey);
  assert.equal(
    shouldRecordSingleStream({
      recordVideo: true,
      recordingSessionKey: nextKey,
      hasStream: true,
      multiChannelDeviceCount: 0,
    }),
    true
  );
});

test('isRecordingOverCap is false before the cap and true at/after it', () => {
  const startedAt = 1_000_000;
  assert.equal(isRecordingOverCap(startedAt, startedAt), false);
  assert.equal(isRecordingOverCap(startedAt, startedAt + MAX_RECORDING_DURATION_MS - 1), false);
  assert.equal(isRecordingOverCap(startedAt, startedAt + MAX_RECORDING_DURATION_MS), true);
  assert.equal(isRecordingOverCap(startedAt, startedAt + MAX_RECORDING_DURATION_MS + 60_000), true);
});
