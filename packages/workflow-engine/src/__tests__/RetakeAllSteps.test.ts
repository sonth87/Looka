import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureSession, CaptureWorkflow } from '@face/core';

/**
 * `retakeAllSteps()` — the post-save "chụp lại toàn bộ" feature (2026-09-08).
 * See its own doc comment in WorkflowEngine.ts for why this exists alongside
 * `retakeStep()`/`startSession()`: it must reset every step without minting
 * a new session id, since the whole point is for the outbox/video pipeline
 * to recognise the redo as replacing the same session's earlier attempt.
 */
describe('WorkflowEngine retakeAllSteps', () => {
  const sampleWorkflow: CaptureWorkflow = {
    id: 'test-retake-all',
    name: 'Test Retake All',
    version: 1,
    steps: [
      { id: 'step-front', type: 'FRONT', instruction: 'Nhìn thẳng vào camera', capture: { enabled: true } },
      { id: 'step-left', type: 'LEFT', instruction: 'Quay mặt sang trái', capture: { enabled: true } },
    ],
  };

  const shotUrl = (n: number): string => `data:image/jpeg;base64,${'a'.repeat(120)}shot${n}`;

  const createEngine = (): WorkflowEngine => {
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => shotUrl(++shot));
    return engine;
  };

  const stepOf = (engine: WorkflowEngine, stepId: string) =>
    engine.currentSession!.steps.find((s) => s.stepId === stepId)!;

  test('rejects when there is no active session at all', () => {
    const engine = createEngine();
    assert.equal(engine.retakeAllSteps(), false);
  });

  test('rejects once the session has been cancelled', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.cancelSession();

    assert.equal(engine.retakeAllSteps(), false);
    assert.equal(engine.currentSession?.status, 'CANCELLED');
  });

  test('resets every step to PENDING and rewinds to the first one, without changing the session id', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();

    assert.equal(engine.currentSession?.status, 'COMPLETED');
    const originalId = engine.currentSession!.id;

    assert.equal(engine.retakeAllSteps(), true);

    assert.equal(engine.currentSession?.id, originalId, 'same session, not a fresh startSession()');
    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(engine.currentSession?.completedAt, undefined);
    assert.equal(engine.currentState.stepId, 'step-front');
    assert.equal(engine.currentState.currentStepIndex, 0);
    assert.equal(stepOf(engine, 'step-front').status, 'PENDING');
    assert.equal(stepOf(engine, 'step-left').status, 'PENDING');
    // Old photos survive until each step's replacement actually lands.
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, shotUrl(1));
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, shotUrl(2));
    // Not "retaking a specific step" — the ordinary capture flow drives it.
    assert.equal(engine.retakingStepId, null);
  });

  test('counts as a further attempt on every step, not just one', async () => {
    const engine = createEngine();
    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();

    const frontBefore = stepOf(engine, 'step-front').attempts;
    const leftBefore = stepOf(engine, 'step-left').attempts;

    engine.retakeAllSteps();

    assert.equal(stepOf(engine, 'step-front').attempts, frontBefore + 1);
    assert.equal(stepOf(engine, 'step-left').attempts, leftBefore + 1);
  });

  test('recapturing every step in order completes the session again, replacing every photo', async () => {
    const engine = createEngine();
    const completions: CaptureSession[] = [];
    engine.on('completed', (session: CaptureSession) => completions.push(session));

    await engine.startSession(sampleWorkflow);
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();
    assert.equal(completions.length, 1);

    engine.retakeAllSteps();
    await engine.triggerManualCapture();
    await engine.triggerManualCapture();

    assert.equal(completions.length, 2);
    assert.equal(engine.currentSession?.status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-front').capturedImagePath, shotUrl(3));
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, shotUrl(4));
  });
});
