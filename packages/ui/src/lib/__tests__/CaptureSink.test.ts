import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSink, ElectronCaptureSink, RunScopedCaptureSession } from '../CaptureSink.js';
import type { ApprovalStepInfo, StudentSubjectInfo } from '../CaptureSink.js';

/**
 * Stubs the desktop preload bridge `ElectronCaptureSink` reaches through
 * `(window as any).faceAPI`. This suite runs under plain Node (`node --test`,
 * no DOM), so `window` does not exist until a test defines it — set here and
 * always cleaned up in a `finally` so it cannot leak into an unrelated test
 * in this same file.
 */
function withFakeWindow<T>(faceAPI: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  (globalThis as any).window = { faceAPI };
  return run().finally(() => {
    delete (globalThis as any).window;
  });
}

/**
 * Records every call so a test can assert not just outcomes but which sink
 * methods actually ran — the collision bug this guards against (see
 * RunScopedCaptureSession's doc comment) is invisible in outcomes alone: the
 * call to `savePhoto` still "succeeds," it just silently reuses an id it
 * should not.
 *
 * `startSessionDelayMs` lets a test force `startSession` to resolve on a
 * later tick (a real `setTimeout`, not just a microtask) instead of settling
 * as soon as any caller happens to await it — the same way the real sinks
 * resolve only after a round trip to the desktop main process or the
 * backend. That is what makes a concurrent-callers test meaningful rather
 * than incidental: without a real delay, two `ensure()` calls racing ahead
 * of `RunScopedCaptureSession`'s fix would still *usually* both lose the
 * race to the same synchronous tick and the bug would reproduce anyway, but
 * the test would not be exercising the same "genuinely still in flight when
 * the second caller arrives" window the field bug depends on.
 */
function fakeSink(
  options: { approveShouldFail?: boolean; startSessionDelayMs?: number } = {}
) {
  let nextId = 0;
  let startSessionCalls = 0;
  const calls: string[] = [];
  const approveUploadSteps: Array<ApprovalStepInfo[] | undefined> = [];
  const approveUploadVideoSessionIds: Array<string | undefined> = [];
  const approveUploadSubjects: Array<StudentSubjectInfo | undefined> = [];
  const startSessionInputs: Array<{ subjectCode?: string; subjectName?: string; metadata?: Record<string, unknown> }> = [];

  const sink: CaptureSink = {
    async startSession(input) {
      startSessionCalls += 1;
      startSessionInputs.push(input);
      if (options.startSessionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.startSessionDelayMs));
      }
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
    async approveUpload(sessionId, steps, videoSessionId, subject) {
      calls.push(`approveUpload:${sessionId}`);
      approveUploadSteps.push(steps);
      approveUploadVideoSessionIds.push(videoSessionId);
      approveUploadSubjects.push(subject);
      if (options.approveShouldFail) throw new Error('approve failed');
    },
  };

  return {
    sink,
    calls,
    approveUploadSteps,
    approveUploadVideoSessionIds,
    approveUploadSubjects,
    startSessionInputs,
    get startSessionCalls() {
      return startSessionCalls;
    },
  };
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

test('approve() forwards per-step context through to the sink unchanged', async () => {
  // FaceCaptureApp's onAccept builds this from the completed session — see
  // uploads.ts's SessionApprovalStepInfo doc comment for why the outbox row
  // alone cannot supply stepType/cameraRole/capturedAt.
  const { sink, calls, approveUploadSteps } = fakeSink();
  const run = new RunScopedCaptureSession(sink);
  const steps = [
    { stepId: 'step-front', stepType: 'FRONT', cameraRole: 'CENTER', attempt: 1, capturedAt: '2026-09-06T10:00:00.000Z' },
  ];

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.approve(steps);

  assert.deepEqual(calls, ['startSession', 'savePhoto:session_1:step-front:1', 'approveUpload:session_1']);
  assert.deepEqual(approveUploadSteps, [steps]);
});

test('approve() with no steps argument forwards undefined, not an empty array', async () => {
  const { sink, approveUploadSteps } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.approve();

  assert.deepEqual(approveUploadSteps, [undefined]);
});

test('approve() forwards videoSessionId through to the sink unchanged', async () => {
  // FaceCaptureApp's onAccept passes completedSession.id (the workflow
  // engine's own session id — a different id space than this sink's own
  // sessionId, see CaptureSink.approveUpload's doc comment) as this
  // argument, verbatim.
  const { sink, approveUploadVideoSessionIds } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.approve(undefined, 'session_1700000000000');

  assert.deepEqual(approveUploadVideoSessionIds, ['session_1700000000000']);
});

const STUDENT: StudentSubjectInfo = {
  subjectCode: 'SV001',
  subjectName: 'Nguyễn Văn An',
  className: 'CNTT01',
  major: 'Công nghệ thông tin',
  academicYear: '2025-2026',
};

test('setSubject() before the first capture makes ensure() send it to startSession (the web path)', async () => {
  const { sink, startSessionInputs } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.setSubject(STUDENT);
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });

  assert.deepEqual(startSessionInputs, [
    {
      subjectCode: 'SV001',
      subjectName: 'Nguyễn Văn An',
      metadata: {
        className: 'CNTT01',
        major: 'Công nghệ thông tin',
        academicYear: '2025-2026',
        identityNumber: undefined,
      },
    },
  ]);
});

test('setSubject() with identityNumber (CCCD-scan path) sends it through to startSession metadata too', async () => {
  const { sink, startSessionInputs } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.setSubject({ ...STUDENT, identityNumber: '014203003990' });
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });

  assert.equal(startSessionInputs[0]?.metadata?.identityNumber, '014203003990');
});

test('with no setSubject() call, ensure() sends startSession an all-undefined subject, not {}', async () => {
  // ElectronCaptureSink.startSession() ignores its input entirely (a pure
  // no-op — see its own doc comment), so this only matters for the web
  // path, but the caching layer must behave identically regardless of which
  // sink is active.
  const { sink, startSessionInputs } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });

  assert.deepEqual(startSessionInputs, [
    {
      subjectCode: undefined,
      subjectName: undefined,
      metadata: { className: undefined, major: undefined, academicYear: undefined, identityNumber: undefined },
    },
  ]);
});

test('setSubject() before approve() forwards the cached student to the kiosk approve path', async () => {
  // ElectronCaptureSink.startSession() never talks to the API — this is the
  // *only* path a kiosk session's subject identity actually reaches the
  // server through, via approveSessionUpload()'s SESSION_REPORT.
  const { sink, approveUploadSubjects } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.setSubject(STUDENT);
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.approve();

  assert.deepEqual(approveUploadSubjects, [STUDENT]);
});

test('reset() clears the cached subject so an abandoned run never leaks its student into the next one', async () => {
  const { sink, startSessionInputs } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.setSubject(STUDENT);
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  run.reset();
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,bbbb' });

  assert.equal(startSessionInputs[0].subjectCode, 'SV001');
  assert.equal(startSessionInputs[1].subjectCode, undefined);
});

test('complete() clears the cached subject too, same as reset()', async () => {
  const { sink, startSessionInputs } = fakeSink();
  const run = new RunScopedCaptureSession(sink);

  run.setSubject(STUDENT);
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.complete();
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,bbbb' });

  assert.equal(startSessionInputs[0].subjectCode, 'SV001');
  assert.equal(startSessionInputs[1].subjectCode, undefined);
});

test('two savePhoto calls fired in the same tick share one startSession call, not two', async () => {
  // Regression test for the field bug: simultaneous capture (one shutter
  // press feeding every physical camera at once — see
  // WorkflowEngine.recordExternalCapture) fires this screen's CENTER
  // storePhoto and every side frame's recordExternalCapture -> capture-
  // trigger -> storePhoto synchronously, in the same tick, from
  // FaceCaptureApp's shared 'capture-trigger' handler — see that handler
  // and RunScopedCaptureSession's own doc comment. Before ensure() memoised
  // the in-flight promise, both callers observed sessionId === null before
  // either had awaited startSession, so each opened its own session: a
  // FRONT photo under one id and a LEFT photo under another, with approve()
  // only ever able to release the one it cached last.
  // Not destructured: `startSessionCalls` is a live getter, and destructuring
  // it here would snapshot its value (0) before either savePhoto call runs.
  const fake = fakeSink({ startSessionDelayMs: 5 });
  const { sink, calls } = fake;
  const run = new RunScopedCaptureSession(sink);

  await Promise.all([
    run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' }),
    run.savePhoto({ stepId: 'step-left', attempt: 1, dataUrl: 'data:image/jpeg;base64,bbbb' }),
  ]);

  assert.equal(
    fake.startSessionCalls,
    1,
    'startSession must be called exactly once for two concurrent savePhoto calls'
  );

  const savePhotoCalls = calls.filter((c) => c.startsWith('savePhoto:'));
  assert.equal(savePhotoCalls.length, 2);
  // Both photos must land under the SAME session id — the id startSession
  // actually returned, not two different ones.
  assert.deepEqual(new Set(savePhotoCalls), new Set([
    'savePhoto:session_1:step-front:1',
    'savePhoto:session_1:step-left:1',
  ]));

  // approve() afterwards must release that same shared session — not
  // silently fail to find one, and not release only one of the two photos'
  // session while leaving the other's forever staged.
  await run.approve();
  assert.equal(calls[calls.length - 1], 'approveUpload:session_1');
});

test('sequential savePhoto calls still share one session id (guards existing behaviour)', async () => {
  // The concurrent case above must not come at the cost of the ordinary,
  // one-photo-at-a-time flow: a session opened by the first capture must
  // still be reused by every capture that awaits it before starting its
  // own, exactly as before this fix.
  const fake = fakeSink({ startSessionDelayMs: 5 });
  const { sink, calls } = fake;
  const run = new RunScopedCaptureSession(sink);

  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });
  await run.savePhoto({ stepId: 'step-left', attempt: 1, dataUrl: 'data:image/jpeg;base64,bbbb' });

  assert.equal(fake.startSessionCalls, 1);
  assert.deepEqual(calls, [
    'startSession',
    'savePhoto:session_1:step-front:1',
    'savePhoto:session_1:step-left:1',
  ]);
});

test('a failed startSession does not stay memoised — the next ensure() retries', async () => {
  // Without clearing the cached promise on failure, every subsequent
  // savePhoto in the same run would keep awaiting the same rejection
  // forever, even after whatever made the sink fail (e.g. a dropped IPC
  // call) has passed.
  let attempt = 0;
  const calls: string[] = [];
  const sink: CaptureSink = {
    async startSession() {
      attempt += 1;
      if (attempt === 1) throw new Error('transient failure');
      return `session_${attempt}`;
    },
    async savePhoto(input) {
      calls.push(`savePhoto:${input.sessionId}:${input.stepId}:${input.attempt}`);
    },
    async completeSession() {},
    async approveUpload() {},
  };
  const run = new RunScopedCaptureSession(sink);

  await assert.rejects(
    () => run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' }),
    /transient failure/
  );
  await run.savePhoto({ stepId: 'step-front', attempt: 1, dataUrl: 'data:image/jpeg;base64,aaaa' });

  assert.equal(attempt, 2);
  assert.deepEqual(calls, ['savePhoto:session_2:step-front:1']);
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

// ── ElectronCaptureSink.approveUpload ───────────────────────────────────────
//
// Regression coverage for the 2026-09-05 field bug: three-frame simultaneous
// sessions where the operator pressed "Xác nhận & Lưu hồ sơ", the modal
// closed normally, no error ever appeared, yet the desktop SQLite
// `upload_outbox` rows stayed PENDING/`approved_at` NULL forever and nothing
// uploaded. `RunScopedCaptureSession.approve()` (tested above with a fake
// sink) was already correct — it forwards whatever the sink resolves with, or
// throws if the sink throws. The real, unexercised gap was one layer down:
// `ElectronCaptureSink.approveUpload` only checked `result.ok`, and the main
// process's `session:approveUpload` handler deliberately reports
// `{ ok: true, approved: 0 }` — not an error — for a sessionId that matches
// no still-staged rows (see that handler's own doc comment). `ok: true` alone
// used to read as success no matter what `approved` said, so a genuine no-op
// approve resolved exactly like a real one: no exception, review screen
// closes, SESSION_COMPLETED gets reported — with the actual photos never
// released.

test('ElectronCaptureSink.approveUpload rejects when the main process approved 0 rows', () =>
  withFakeWindow(
    { approveSessionUpload: async () => ({ ok: true, approved: 0 }) },
    async () => {
      const sink = new ElectronCaptureSink();
      await assert.rejects(
        () => sink.approveUpload('session_stuck'),
        /Không tìm thấy ảnh nào của phiên này để duyệt/
      );
    }
  ));

test('ElectronCaptureSink.approveUpload rejects when approved is missing from the response', () =>
  // Defends against a future main-process change that drops the field
  // entirely rather than sending 0 — `undefined > 0` is false in JS, so this
  // must reject exactly like the explicit-zero case above, not silently pass.
  withFakeWindow({ approveSessionUpload: async () => ({ ok: true }) }, async () => {
    const sink = new ElectronCaptureSink();
    await assert.rejects(() => sink.approveUpload('session_stuck'));
  }));

test('ElectronCaptureSink.approveUpload resolves when the main process actually released rows', () =>
  withFakeWindow(
    { approveSessionUpload: async () => ({ ok: true, approved: 3 }) },
    async () => {
      const sink = new ElectronCaptureSink();
      await assert.doesNotReject(() => sink.approveUpload('session_ok'));
    }
  ));

test('ElectronCaptureSink.approveUpload still rejects on an explicit ok:false, same as before', () =>
  withFakeWindow(
    { approveSessionUpload: async () => ({ ok: false, error: 'boom' }) },
    async () => {
      const sink = new ElectronCaptureSink();
      await assert.rejects(() => sink.approveUpload('session_x'), /boom/);
    }
  ));

test('ElectronCaptureSink.approveUpload forwards sessionId, steps, and videoSessionId in one payload to faceAPI', async () => {
  const calls: unknown[] = [];
  await withFakeWindow(
    {
      approveSessionUpload: async (payload: unknown) => {
        calls.push(payload);
        return { ok: true, approved: 1 };
      },
    },
    async () => {
      const sink = new ElectronCaptureSink();
      const steps = [{ stepId: 'step-front', stepType: 'FRONT', cameraRole: 'CENTER', attempt: 1 }];
      await sink.approveUpload('session_ok', steps, 'session_1700000000000');
    }
  );
  assert.deepEqual(calls, [
    {
      sessionId: 'session_ok',
      steps: [{ stepId: 'step-front', stepType: 'FRONT', cameraRole: 'CENTER', attempt: 1 }],
      videoSessionId: 'session_1700000000000',
      subjectCode: undefined,
      subjectName: undefined,
      metadata: undefined,
      operatorUserId: undefined,
    },
  ]);
});

// videoSessionId is a separate id space (the workflow engine's own
// CaptureSession.id) from sessionId (this sink's own crypto.randomUUID()) —
// see CaptureSink.approveUpload's own doc comment. A caller with nothing to
// send (no video recorded this run) must still forward `undefined` rather
// than omit the field or substitute sessionId, so the main process's own
// fallback-to-sessionId logic (apps/desktop's uploads.ts) is the only place
// that decision is made.
test('ElectronCaptureSink.approveUpload forwards videoSessionId as undefined when the caller has none', async () => {
  const calls: unknown[] = [];
  await withFakeWindow(
    {
      approveSessionUpload: async (payload: unknown) => {
        calls.push(payload);
        return { ok: true, approved: 1 };
      },
    },
    async () => {
      const sink = new ElectronCaptureSink();
      await sink.approveUpload('session_ok');
    }
  );
  assert.deepEqual(calls, [
    {
      sessionId: 'session_ok',
      steps: undefined,
      videoSessionId: undefined,
      subjectCode: undefined,
      subjectName: undefined,
      metadata: undefined,
      operatorUserId: undefined,
    },
  ]);
});

test('ElectronCaptureSink.approveUpload forwards a student subject as subjectCode/subjectName/metadata', async () => {
  const calls: unknown[] = [];
  await withFakeWindow(
    {
      approveSessionUpload: async (payload: unknown) => {
        calls.push(payload);
        return { ok: true, approved: 1 };
      },
    },
    async () => {
      const sink = new ElectronCaptureSink();
      await sink.approveUpload('session_ok', undefined, undefined, {
        subjectCode: 'SV001',
        subjectName: 'Nguyễn Văn An',
        className: 'CNTT01',
        major: 'Công nghệ thông tin',
        academicYear: '2025-2026',
      });
    }
  );
  assert.deepEqual(calls, [
    {
      sessionId: 'session_ok',
      steps: undefined,
      videoSessionId: undefined,
      subjectCode: 'SV001',
      subjectName: 'Nguyễn Văn An',
      metadata: {
        className: 'CNTT01',
        major: 'Công nghệ thông tin',
        academicYear: '2025-2026',
        identityNumber: undefined,
      },
      operatorUserId: undefined,
    },
  ]);
});

test('ElectronCaptureSink.approveUpload forwards identityNumber (CCCD-scan path) inside metadata', async () => {
  const calls: unknown[] = [];
  await withFakeWindow(
    {
      approveSessionUpload: async (payload: unknown) => {
        calls.push(payload);
        return { ok: true, approved: 1 };
      },
    },
    async () => {
      const sink = new ElectronCaptureSink();
      await sink.approveUpload('session_ok', undefined, undefined, {
        subjectCode: 'SV001',
        subjectName: 'Nguyễn Văn An',
        className: 'CNTT01',
        major: 'Công nghệ thông tin',
        academicYear: '2025-2026',
        identityNumber: '014203003990',
      });
    }
  );
  const payload = calls[0] as { metadata?: Record<string, unknown> };
  assert.equal(payload.metadata?.identityNumber, '014203003990');
});
