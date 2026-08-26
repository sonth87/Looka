import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSink, RunScopedCaptureSession } from '../CaptureSink.js';

/**
 * Records every call so a test can assert not just outcomes but which sink
 * methods actually ran — the collision bug this guards against (see
 * RunScopedCaptureSession's doc comment) is invisible in outcomes alone: the
 * call to `savePhoto` still "succeeds," it just silently reuses an id it
 * should not.
 */
function fakeSink(options: { approveShouldFail?: boolean } = {}) {
  let nextId = 0;
  const calls: string[] = [];

  const sink: CaptureSink = {
    async startSession() {
      calls.push('startSession');
      nextId += 1;
      return `session_${nextId}`;
    },
    async savePhoto(input) {
      calls.push(`savePhoto:${input.sessionId}:${input.stepId}:${input.attempt}`);
    },
    async completeSession(sessionId) {
      calls.push(`completeSession:${sessionId}`);
    },
    async approveUpload(sessionId) {
      calls.push(`approveUpload:${sessionId}`);
      if (options.approveShouldFail) throw new Error('approve failed');
    },
  };

  return { sink, calls };
}

test('photos captured within one run share the same session id', async () => {
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.savePhoto({ stepId: 'step-left', attempt: 1, dataUrl: 'data:image/jpeg;base64,bbbb' });

  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    'savePhoto:session_1:step-left:1',
  ]);
});

test('completing a run tells the sink, then clears the id so the next run opens a fresh one', async () => {
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.complete();
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,cccc' });

  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    'completeSession:session_1',
    'startSession',
    'savePhoto:session_2:step-front:1',
  ]);
});

test('abandoning a run (cancel, or "retake all") never reuses its session id', async () => {
  // This is the exact shape of the bug: a run captures a couple of steps,
  // gets cancelled or restarted before finishing (SessionReviewModal allows
  // "Chụp lại toàn bộ" from as little as one captured step — see its
  // isComplete comment), and a new run begins. Both runs number their own
  // steps from attempt 1, so if the new run inherited the old run's session
  // id, its first capture of step-front would carry the exact idemKey the
  // abandoned run's did, and the desktop outbox's
  // ON CONFLICT(idem_key) DO NOTHING (packages/database's
  // UploadOutboxRepository.enqueue) would silently drop it — the photo is
  // captured locally and never queued for upload at all.
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  run.reset();
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,dddd' });

  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    // reset() must not call completeSession — the run was abandoned, not
    // finished — and the second savePhoto must have opened a NEW session
    // rather than reusing session_1.
    'startSession',
    'savePhoto:session_2:step-front:1',
  ]);
});

test('reset before any capture is a harmless no-op', async () => {
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.reset();
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });

  assert.deepEqual(calls, ['startSession', 'savePhoto:session_1:step-front:1']);
});

test('complete() before any capture never calls the sink', async () => {
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.complete();

  assert.deepEqual(calls, []);
});

test('with no sink configured, savePhoto rejects instead of pretending to succeed', async () => {
  const run = new RunScopedCaptureSession(null);

  await assert.rejects(
    () => run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' }),
    /No CaptureSink configured/
  );
});

test('approve() before any capture throws instead of silently doing nothing', async () => {
  // Used to return silently, which made the review screen's Accept button
  // report success (no exception, modal closes) without ever calling the
  // sink — see approve()'s own doc comment for the hot-reload scenario this
  // was hiding.
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await assert.rejects(() => run.approve(), /No active capture session/);

  assert.deepEqual(calls, []);
});

test('approve() uses the run\'s current session id without clearing it', async () => {
  // Unlike complete(), approving must not end the run: the review screen
  // calls approve() and then still needs complete() to work on the same
  // session right after (see FaceCaptureApp's onAccept).
  const { sink, calls } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.approve();
  await run.complete();

  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    'approveUpload:session_1',
    'completeSession:session_1',
  ]);
});

test('a failed approve() leaves the session id intact so the caller can retry', async () => {
  // The captures are never lost either way (they simply stay staged), so
  // losing the ability to approve on a transient failure would be strictly
  // worse than just letting the next click try again against the same run.
  const { sink, calls } = fakeSink({ approveShouldFail: true });
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await assert.rejects(() => run.approve(), /approve failed/);

  // Retrying calls approveUpload again for the SAME session, not a new one.
  await run.approve().catch(() => {});
  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    'approveUpload:session_1',
    'approveUpload:session_1',
  ]);
});
