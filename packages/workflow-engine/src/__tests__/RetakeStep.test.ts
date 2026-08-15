import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureSession, CaptureWorkflow } from '@face/core';

describe('WorkflowEngine retake', () => {
  const sampleWorkflow: CaptureWorkflow = {
    id: 'test-retake',
    name: 'Test Retake',
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
    ],
  };

  /** Numbered snapshots, so a replaced image can be told apart from the one it replaced. */
  const createEngine = (): WorkflowEngine => {
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,shot-${++shot}`);
    return engine;
  };

  const stepOf = (engine: WorkflowEngine, stepId: string) =>
    engine.currentSession!.steps.find((s) => s.stepId === stepId)!;

  test('rejects a step id the workflow does not contain', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);

    assert.equal(await engine.retakeStep('step-nowhere'), false);
    assert.equal(engine.retakingStepId, null);
    assert.equal(engine.currentState.stepId, 'step-front');
  });

  test('rejects a retake once the session has been cancelled', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.cancelSession();

    assert.equal(await engine.retakeStep('step-front'), false);
    assert.equal(engine.currentSession?.status, 'CANCELLED');
  });

  test('replaces only the retaken image and closes a finished session again', async () => {
    const engine = createEngine();
    const completions: CaptureSession[] = [];
    engine.on('completed', (session: CaptureSession) => completions.push(session));

    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();

    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.equal(completions.length, 1);

    assert.equal(await engine.retakeStep('step-front'), true);
    assert.equal(engine.retakingStepId, 'step-front');
    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(engine.currentSession?.completedAt, undefined);
    assert.equal(engine.currentState.stepId, 'step-front');
    // The photo being replaced survives until the replacement actually lands.
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, 'data:image/jpeg;base64,shot-1');

    await engine.triggerManualCapture();

    assert.equal(stepOf(engine, 'step-front').capturedImagePath, 'data:image/jpeg;base64,shot-3');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'data:image/jpeg;base64,shot-2');
    assert.equal(stepOf(engine, 'step-front').status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-left').status, 'COMPLETED');
    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.equal(engine.retakingStepId, null);
    assert.equal(completions.length, 2);
  });

  test('reports the retaken step and returns to the interrupted one mid-session', async () => {
    const engine = createEngine();
    const retaken: { stepId: string; imagePath: string }[] = [];
    engine.on('step-retaken', (payload: { stepId: string; imagePath: string }) =>
      retaken.push(payload)
    );

    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    assert.equal(engine.currentState.stepId, 'step-left');

    assert.equal(await engine.retakeStep('step-front'), true);
    await engine.triggerManualCapture();

    assert.deepEqual(retaken, [
      { stepId: 'step-front', imagePath: 'data:image/jpeg;base64,shot-2' },
    ]);
    // Capture resumes where the retake interrupted it rather than running off the end.
    assert.equal(engine.currentState.stepId, 'step-left');
    assert.equal(engine.currentState.currentStepIndex, 1);
    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(stepOf(engine, 'step-left').status, 'PENDING');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, undefined);
  });

  test('counts the retake as a further attempt on that step alone', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();

    const attemptsBefore = stepOf(engine, 'step-front').attempts;
    await engine.retakeStep('step-front');
    await engine.triggerManualCapture();

    assert.equal(stepOf(engine, 'step-front').attempts, attemptsBefore + 1);
    assert.equal(stepOf(engine, 'step-left').attempts, 0);
  });

  test('nested retakes still return to the step ordered capture had reached', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    assert.equal(engine.currentState.currentStepIndex, 1);

    await engine.retakeStep('step-front');
    assert.equal(await engine.retakeStep('step-front'), true);
    assert.equal(engine.retakingStepId, 'step-front');

    await engine.triggerManualCapture();

    assert.equal(engine.currentState.currentStepIndex, 1);
    assert.equal(engine.retakingStepId, null);
  });

  test('starting a session clears a retake that was never taken', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.retakeStep('step-front');
    assert.equal(engine.retakingStepId, 'step-front');

    await engine.startSession(sampleWorkflow);

    assert.equal(engine.retakingStepId, null);
    assert.equal(engine.currentState.currentStepIndex, 0);
    assert.equal(
      engine.currentSession?.steps.every((s) => s.status === 'PENDING'),
      true
    );
  });
});
