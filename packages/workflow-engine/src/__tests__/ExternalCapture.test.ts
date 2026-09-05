import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureSession, CaptureWorkflow } from '@face/core';

/**
 * Coverage for `recordExternalCapture` — the "simultaneous capture" entry
 * point. A kiosk with one physical camera per frame (CENTER/LEFT/RIGHT/UP/
 * DOWN) fires every camera on a single shutter press, so the engine has to
 * accept an image for a step it never evaluated a frame for, with no pose/
 * quality gate, while still driving the same step list, `capture-trigger`
 * pipeline, and completion flow a normal capture does.
 */
describe('WorkflowEngine.recordExternalCapture', () => {
  const threeStepWorkflow: CaptureWorkflow = {
    id: 'test-external-capture',
    name: 'Test External Capture',
    version: 1,
    steps: [
      {
        id: 'step-front',
        type: 'FRONT',
        instruction: 'Nhìn thẳng vào camera',
        capture: { enabled: true },
      },
      {
        id: 'step-left',
        type: 'LEFT',
        instruction: 'Quay mặt sang trái',
        capture: { enabled: true },
      },
      {
        id: 'step-right',
        type: 'RIGHT',
        instruction: 'Quay mặt sang phải',
        capture: { enabled: true },
      },
    ],
  };

  const createEngine = (): WorkflowEngine => new WorkflowEngine();

  const stepOf = (engine: WorkflowEngine, stepId: string) =>
    engine.currentSession!.steps.find((s) => s.stepId === stepId)!;

  test('returns false when there is no active session', () => {
    const engine = createEngine();
    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), false);
  });

  test('returns false for a stepId the workflow does not contain', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);
    assert.equal(engine.recordExternalCapture('step-nowhere', 'img://x'), false);
    assert.equal(engine.currentState.stepId, 'step-front');
  });

  test('returns false once the session is cancelled', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);
    await engine.cancelSession();
    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), false);
  });

  test('returns false for a step that is already COMPLETED', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);

    assert.equal(engine.recordExternalCapture('step-front', 'img://front-1'), true);
    // Second call targets the same, now-COMPLETED step.
    assert.equal(engine.recordExternalCapture('step-front', 'img://front-2'), false);
    // The first recording is left untouched by the rejected second call.
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, 'img://front-1');
  });

  test('recording the current step emits capture-trigger, completes it, and advances', async () => {
    const engine = createEngine();
    const triggers: { stepId: string; imagePath: string }[] = [];
    engine.on('capture-trigger', (payload: { stepId: string; imagePath: string }) =>
      triggers.push(payload)
    );

    await engine.startSession(threeStepWorkflow);
    assert.equal(engine.currentState.stepId, 'step-front');

    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), true);

    assert.deepEqual(triggers, [{ stepId: 'step-front', imagePath: 'img://front' }]);
    assert.equal(stepOf(engine, 'step-front').status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, 'img://front');
    // Advanced past the just-completed current step to the next one.
    assert.equal(engine.currentState.stepId, 'step-left');
    assert.equal(engine.currentState.currentStepIndex, 1);
    assert.equal(engine.currentSession?.status, 'RUNNING');
  });

  test('recording a future step completes it without moving the current index, and a later advance skips it', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);
    assert.equal(engine.currentState.stepId, 'step-front');

    // step-left is a future step: not the one currently being worked on.
    assert.equal(engine.recordExternalCapture('step-left', 'img://left'), true);

    assert.equal(stepOf(engine, 'step-left').status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left');
    // The current index did not move for a future step.
    assert.equal(engine.currentState.stepId, 'step-front');
    assert.equal(engine.currentState.currentStepIndex, 0);

    // Completing the still-current step drives the normal advance logic,
    // which must skip the already-COMPLETED step-left and land on step-right.
    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), true);

    assert.equal(engine.currentState.stepId, 'step-right');
    assert.equal(engine.currentState.currentStepIndex, 2);
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left');
  });

  test('recording every step completes the session and emits completed once', async () => {
    const engine = createEngine();
    const completions: CaptureSession[] = [];
    engine.on('completed', (session: CaptureSession) => completions.push(session));

    await engine.startSession(threeStepWorkflow);

    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), true);
    assert.equal(engine.recordExternalCapture('step-left', 'img://left'), true);
    assert.equal(engine.recordExternalCapture('step-right', 'img://right'), true);

    assert.equal(completions.length, 1);
    assert.equal(completions[0].status, 'COMPLETED');
    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.equal(engine.currentState.status, 'SUCCESS');

    assert.equal(stepOf(engine, 'step-front').capturedImagePath, 'img://front');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left');
    assert.equal(stepOf(engine, 'step-right').capturedImagePath, 'img://right');
  });

  test('attempts increments on every successful record', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);

    assert.equal(stepOf(engine, 'step-front').attempts, 0);
    assert.equal(stepOf(engine, 'step-left').attempts, 0);

    engine.recordExternalCapture('step-front', 'img://front');
    engine.recordExternalCapture('step-left', 'img://left');

    assert.equal(stepOf(engine, 'step-front').attempts, 1);
    assert.equal(stepOf(engine, 'step-left').attempts, 1);
    // Untouched step is unaffected.
    assert.equal(stepOf(engine, 'step-right').attempts, 0);
  });

  test('retryStep still works on a step that was externally captured', async () => {
    const engine = createEngine();
    await engine.startSession(threeStepWorkflow);

    // Externally capture the current step; the engine advances past it.
    assert.equal(engine.recordExternalCapture('step-front', 'img://front'), true);
    assert.equal(engine.currentState.stepId, 'step-left');
    assert.equal(stepOf(engine, 'step-front').status, 'COMPLETED');
    const attemptsAfterRecord = stepOf(engine, 'step-front').attempts;

    // Re-enter the externally captured step to retry it, exactly as a UI
    // "retake" flow would for a normally captured one.
    assert.equal(await engine.retakeStep('step-front'), true);
    assert.equal(engine.currentState.stepId, 'step-front');

    await engine.retryStep();

    // retryStep works the same regardless of how the step's photo was
    // originally recorded: status goes back to pending/current, and the
    // attempt count keeps climbing.
    assert.equal(stepOf(engine, 'step-front').status, 'PENDING');
    assert.equal(stepOf(engine, 'step-front').attempts, attemptsAfterRecord + 2);
  });
});
