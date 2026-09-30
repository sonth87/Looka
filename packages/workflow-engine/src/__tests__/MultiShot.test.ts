import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureWorkflow } from '@face/core';

/**
 * Coverage for the multi-shot CENTER step (`CaptureWorkflow.multiShotStepId`):
 * the one step whose photo may be shot repeatedly, with the operator choosing
 * the best shot before saving. Everything here is opt-in — a workflow without
 * `multiShotStepId` must behave exactly as it always did (last test group).
 */
describe('WorkflowEngine multi-shot step', () => {
  const buildWorkflow = (multiShotStepId?: string): CaptureWorkflow => ({
    id: 'test-multi-shot',
    name: 'Test Multi Shot',
    version: 1,
    ...(multiShotStepId ? { multiShotStepId } : {}),
    steps: [
      { id: 'step-front', type: 'FRONT', instruction: 'Nhìn thẳng vào camera', capture: { enabled: true } },
      { id: 'step-left', type: 'LEFT', instruction: 'Quay mặt sang trái', capture: { enabled: true } },
    ],
  });

  /**
   * Numbered snapshots so every shot is distinguishable. Padded past
   * CaptureController's plausible-payload floor and built from a-z/0-9 only
   * (see RetakeStep.test.ts, which this mirrors).
   */
  const shotUrl = (n: number): string => `data:image/jpeg;base64,${'a'.repeat(120)}shot${n}`;

  const createEngine = (): WorkflowEngine => {
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => shotUrl(++shot));
    return engine;
  };

  const stepOf = (engine: WorkflowEngine, stepId: string) =>
    engine.currentSession!.steps.find((s) => s.stepId === stepId)!;

  /** Runs the whole two-step workflow to COMPLETED through the webcam path (2 captures). */
  const runToCompletion = async (engine: WorkflowEngine) => {
    await engine.startSession(buildWorkflow('step-front'));
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  };

  test('exposes the multi-shot step id (and null when the feature is off)', async () => {
    const on = createEngine();
    assert.equal(on.multiShotStepId, null, 'no workflow yet');
    await on.startSession(buildWorkflow('step-front'));
    assert.equal(on.multiShotStepId, 'step-front');

    const off = createEngine();
    await off.startSession(buildWorkflow());
    assert.equal(off.multiShotStepId, null);
  });

  test('accumulates shots under attempts that match the emitted payload (webcam path)', async () => {
    const engine = createEngine();
    const payloads: Array<{ stepId: string; attempt: number; shotIndex?: number }> = [];
    engine.on('capture-trigger', (p: { stepId: string; attempt: number; shotIndex?: number }) => payloads.push(p));

    await runToCompletion(engine);
    // Two more center shots, each through a retake — exactly what "chụp thêm" does.
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();

    const front = stepOf(engine, 'step-front');
    assert.deepEqual(
      front.shots!.map((s) => s.attempt),
      [1, 2, 3],
      'every shot has its own attempt, so none collides in the outbox'
    );
    assert.deepEqual(
      front.shots!.map((s) => s.imagePath),
      [shotUrl(1), shotUrl(3), shotUrl(4)]
    );

    const frontPayloads = payloads.filter((p) => p.stepId === 'step-front');
    assert.deepEqual(
      frontPayloads.map((p) => p.attempt),
      front.shots!.map((s) => s.attempt),
      'the payload attempt IS the shot attempt (what the listener stores it under)'
    );
    assert.deepEqual(
      frontPayloads.map((p) => p.shotIndex),
      [0, 1, 2]
    );

    // The corner step is a plain single-shot step: no shots, no shotIndex.
    assert.equal(stepOf(engine, 'step-left').shots, undefined);
    const leftPayload = payloads.find((p) => p.stepId === 'step-left')!;
    assert.equal(leftPayload.attempt, 1);
    assert.equal('shotIndex' in leftPayload, false);
  });

  test('attempts stay unique and match the payload on the external-capture path too', async () => {
    const engine = new WorkflowEngine();
    const payloads: Array<{ stepId: string; attempt: number; shotIndex?: number }> = [];
    engine.on('capture-trigger', (p: { stepId: string; attempt: number; shotIndex?: number }) => payloads.push(p));

    await engine.startSession(buildWorkflow('step-front'));
    assert.equal(engine.recordExternalCapture('step-front', 'img://front-1'), true);
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-1'), true);
    assert.equal(engine.currentSession?.status, 'COMPLETED');

    await engine.retakeStep('step-front');
    assert.equal(engine.recordExternalCapture('step-front', 'img://front-2'), true);

    const front = stepOf(engine, 'step-front');
    const frontPayloads = payloads.filter((p) => p.stepId === 'step-front');
    // recordExternalCapture bumps `attempts` before emitting, so the first shot
    // is attempt 2 and the retake's is 4 — never equal, and the same numbers
    // the listener stores the photos under.
    assert.deepEqual(
      front.shots!.map((s) => s.attempt),
      [2, 4]
    );
    assert.deepEqual(
      frontPayloads.map((p) => p.attempt),
      [2, 4]
    );
    assert.deepEqual(
      frontPayloads.map((p) => p.shotIndex),
      [0, 1]
    );
    assert.equal(payloads.find((p) => p.stepId === 'step-left')!.attempt, 2);
  });

  test('auto-selects the newest shot and keeps capturedImagePath in step with it', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();

    const front = stepOf(engine, 'step-front');
    assert.equal(front.shots!.length, 2);
    assert.equal(front.selectedShotIndex, 1);
    assert.equal(front.capturedImagePath, front.shots![1].imagePath);
    assert.equal(engine.currentSession?.status, 'COMPLETED', 'a retake that lands closes the session again');
  });

  test('selectShot switches the selection, copies the shot onto the step and emits shot-selected', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();

    const events: Array<{ stepId: string; index: number; attempt: number }> = [];
    engine.on('shot-selected', (e: { stepId: string; index: number; attempt: number }) => events.push(e));

    const front = stepOf(engine, 'step-front');
    assert.equal(engine.selectShot('step-front', 0), true);

    assert.equal(front.selectedShotIndex, 0);
    assert.equal(front.capturedImagePath, front.shots![0].imagePath);
    assert.equal(front.timestamp, front.shots![0].timestamp);
    assert.deepEqual(events, [{ stepId: 'step-front', index: 0, attempt: 1 }]);
  });

  test('selectShot refuses an out-of-range index, a non multi-shot step and a missing session', async () => {
    const engine = createEngine();
    assert.equal(engine.selectShot('step-front', 0), false, 'no session yet');

    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    const selectedBefore = stepOf(engine, 'step-front').selectedShotIndex;

    assert.equal(engine.selectShot('step-front', -1), false);
    assert.equal(engine.selectShot('step-front', 2), false);
    assert.equal(engine.selectShot('step-front', 0.5), false);
    assert.equal(engine.selectShot('step-left', 0), false, 'not the multi-shot step');
    assert.equal(engine.selectShot('step-nowhere', 0), false);
    assert.equal(stepOf(engine, 'step-front').selectedShotIndex, selectedBefore, 'a refused call changes nothing');
  });

  test('selectShot is refused while a capture is in flight', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    await engine.retakeStep('step-front');

    // Not awaited: `isCapturing` is set synchronously, before the first await.
    const pending = engine.triggerManualCapture();
    assert.equal(engine.isCaptureInFlight, true);
    assert.equal(engine.selectShot('step-front', 0), false);
    await pending;

    assert.equal(engine.isCaptureInFlight, false);
    assert.equal(engine.selectShot('step-front', 0), true, 'allowed again once the shot has landed');
  });

  test('retaking a corner step leaves the center shots and selection alone', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    assert.equal(engine.selectShot('step-front', 0), true);

    const leftBefore = stepOf(engine, 'step-left').capturedImagePath;
    await engine.retakeStep('step-left');
    await engine.triggerManualCapture();

    const front = stepOf(engine, 'step-front');
    assert.equal(front.shots!.length, 2, 'no center shot added or dropped');
    assert.equal(front.selectedShotIndex, 0, 'the operator\'s center pick survives a corner retake');
    assert.equal(front.capturedImagePath, front.shots![0].imagePath);
    // ...while the corner photo was simply replaced (the requirement-2 behaviour).
    assert.notEqual(stepOf(engine, 'step-left').capturedImagePath, leftBefore);
    assert.equal(stepOf(engine, 'step-left').shots, undefined);
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  });

  test('commitShotSelection keeps only the selected shot, as index 0', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    assert.equal(engine.selectShot('step-front', 1), true);
    const keptImage = stepOf(engine, 'step-front').shots![1].imagePath;
    const keptAttempt = stepOf(engine, 'step-front').shots![1].attempt;

    engine.commitShotSelection('step-front');

    const front = stepOf(engine, 'step-front');
    assert.equal(front.shots!.length, 1);
    assert.equal(front.shots![0].imagePath, keptImage);
    assert.equal(front.shots![0].attempt, keptAttempt);
    assert.equal(front.selectedShotIndex, 0);
    assert.equal(front.capturedImagePath, keptImage);

    // A step that is not the multi-shot one is left untouched.
    engine.commitShotSelection('step-left');
    assert.equal(stepOf(engine, 'step-left').shots, undefined);
  });

  test('cancelPendingRetake restores a finished session, emits state-change, and keeps the old photo', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    const photoBefore = stepOf(engine, 'step-front').capturedImagePath;

    await engine.retakeStep('step-front');
    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(stepOf(engine, 'step-front').status, 'PENDING');
    assert.equal(engine.retakingStepId, 'step-front');

    let stateChanges = 0;
    engine.on('state-change', () => stateChanges++);
    const completions: unknown[] = [];
    engine.on('completed', (s: unknown) => completions.push(s));

    assert.equal(engine.cancelPendingRetake(), true);

    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.ok(engine.currentSession?.completedAt, 'completedAt is set again');
    assert.equal(engine.currentState.status, 'SUCCESS');
    assert.equal(stepOf(engine, 'step-front').status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, photoBefore);
    assert.equal(engine.retakingStepId, null);
    assert.ok(stateChanges >= 1, 'listeners are told the state was restored');
    assert.equal(completions.length, 0, 'must not re-open the review modal via `completed`');
  });

  test('cancelPendingRetake returns false and does nothing when no retake is pending', async () => {
    const engine = createEngine();
    assert.equal(engine.cancelPendingRetake(), false, 'no session');

    await runToCompletion(engine);
    assert.equal(engine.cancelPendingRetake(), false, 'nothing pending');
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  });

  test('cancelPendingRetake returns false and changes nothing while a capture is in flight', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');

    const pending = engine.triggerManualCapture();
    assert.equal(engine.isCaptureInFlight, true);
    assert.equal(engine.cancelPendingRetake(), false);
    assert.equal(engine.currentSession?.status, 'RUNNING', 'session untouched');
    assert.equal(engine.retakingStepId, 'step-front', 'retake still pending');

    await pending;
    // The in-flight shot landed and closed the session itself.
    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-front').shots!.length, 2);
  });

  test('cancelPendingRetake resumes ordered capture when the retake interrupted it mid-session', async () => {
    const engine = createEngine();
    await engine.startSession(buildWorkflow('step-front'));
    await engine.triggerManualCapture(); // front done; now on step-left
    assert.equal(engine.currentState.stepId, 'step-left');

    await engine.retakeStep('step-front');
    assert.equal(engine.currentState.stepId, 'step-front');

    assert.equal(engine.cancelPendingRetake(), true);

    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(engine.currentState.stepId, 'step-left', 'back on the step ordered capture had reached');
    assert.equal(engine.currentState.currentStepIndex, 1);
    assert.equal(stepOf(engine, 'step-front').status, 'COMPLETED');
  });

  test('retakeAllSteps drops the multi-shot step\'s shots and selection', async () => {
    const engine = createEngine();
    await runToCompletion(engine);
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();
    assert.equal(stepOf(engine, 'step-front').shots!.length, 2);

    assert.equal(engine.retakeAllSteps(), true);

    assert.equal(stepOf(engine, 'step-front').shots, undefined);
    assert.equal(stepOf(engine, 'step-front').selectedShotIndex, undefined);
  });
});

describe('WorkflowEngine without a multi-shot step (feature off)', () => {
  const plainWorkflow: CaptureWorkflow = {
    id: 'test-plain',
    name: 'Test Plain',
    version: 1,
    steps: [{ id: 'step-front', type: 'FRONT', instruction: 'Nhìn thẳng vào camera', capture: { enabled: true } }],
  };
  const shotUrl = (n: number): string => `data:image/jpeg;base64,${'a'.repeat(120)}shot${n}`;

  test('never records shots, and the payload carries `attempt` but no `shotIndex`', async () => {
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => shotUrl(++shot));
    const payloads: Array<Record<string, unknown>> = [];
    engine.on('capture-trigger', (p: Record<string, unknown>) => payloads.push(p));

    await engine.startSession(plainWorkflow);
    await engine.triggerManualCapture();
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();

    const front = engine.currentSession!.steps[0];
    assert.equal(front.shots, undefined);
    assert.equal(front.selectedShotIndex, undefined);
    assert.deepEqual(
      payloads.map((p) => p.attempt),
      [1, 2],
      'attempt is still reported, exactly as the listener used to derive it'
    );
    assert.equal(payloads.some((p) => 'shotIndex' in p), false);
    // The retake replaced the photo, as ever.
    assert.equal(front.capturedImagePath, shotUrl(2));
  });

  test('selectShot / commitShotSelection do nothing', async () => {
    const engine = new WorkflowEngine();
    engine.setSnapshotProvider(() => shotUrl(1));
    await engine.startSession(plainWorkflow);
    await engine.triggerManualCapture();

    assert.equal(engine.selectShot('step-front', 0), false);
    engine.commitShotSelection('step-front');
    assert.equal(engine.currentSession!.steps[0].shots, undefined);
  });
});
