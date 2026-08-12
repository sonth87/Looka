import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { StepEvaluator } from '../StepEvaluator.js';
import { StabilityTracker } from '../StabilityTracker.js';
import { CaptureWorkflow, FaceState } from '@face/core';

describe('WorkflowEngine & Evaluators', () => {
  const sampleWorkflow: CaptureWorkflow = {
    id: 'test-enrollment',
    name: 'Test Enrollment',
    version: 1,
    steps: [
      {
        id: 'step-front',
        type: 'FRONT',
        instruction: 'Nhìn thẳng vào camera',
        pose: { yaw: { target: 0, tolerance: 10 } },
        stability: { durationMs: 100 },
        capture: { enabled: true },
      },
      {
        id: 'step-left',
        type: 'LEFT',
        instruction: 'Quay mặt sang trái',
        pose: { yaw: { target: -30, tolerance: 10 } },
        stability: { durationMs: 100 },
        capture: { enabled: true },
      },
    ],
  };

  const createMockFaceState = (yaw = 0): FaceState => ({
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: {
      boundingBox: { x: 160, y: 120, width: 320, height: 240 },
      confidence: 0.98,
    },
    pose: { yaw, pitch: 0, roll: 0 },
    quality: {
      overallScore: 0.9,
      accepted: true,
      sharpness: 0.8,
      brightness: 0.7,
      faceSizeRatio: 0.5,
      centerXOffset: 0.02,
      centerYOffset: 0.01,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      reasons: [],
    },
  });

  test('StepEvaluator should pass when pose is within tolerance', () => {
    const evaluator = new StepEvaluator();
    const faceState = createMockFaceState(-25); // Target -30 +/- 10 -> pass (-40 to -20)
    const result = evaluator.evaluate(faceState, sampleWorkflow.steps[1]);

    assert.equal(result.passed, true);
    assert.equal(result.poseValid, true);
  });

  test('StabilityTracker should stabilize after specified duration', () => {
    const tracker = new StabilityTracker();
    const now = Date.now();

    let res = tracker.update(true, 500, now);
    assert.equal(res.isStable, false);

    res = tracker.update(true, 500, now + 300);
    assert.equal(res.isStable, false);
    assert.equal(res.progress, 0.6);

    res = tracker.update(true, 500, now + 500);
    assert.equal(res.isStable, true);
    assert.equal(res.progress, 1.0);
  });

  test('WorkflowEngine should advance steps and complete session', async () => {
    const engine = new WorkflowEngine();
    let completedSession: any = null;

    engine.on('completed', (session) => {
      completedSession = session;
    });

    await engine.startSession(sampleWorkflow);
    assert.equal(engine.currentSession?.status, 'RUNNING');
    assert.equal(engine.currentState.stepId, 'step-front');

    // Process FRONT step frames
    const frontFaceState = createMockFaceState(0);
    await engine.processFrame(frontFaceState); // Frame 1
    
    // Simulate time passing > 100ms for stability
    await new Promise((r) => setTimeout(r, 120));
    await engine.processFrame(frontFaceState); // Frame 2 -> triggers capture for FRONT -> advances to LEFT

    assert.equal(engine.currentState.stepId, 'step-left');

    // Process LEFT step frames
    const leftFaceState = createMockFaceState(-30);
    await engine.processFrame(leftFaceState);
    await new Promise((r) => setTimeout(r, 120));
    await engine.processFrame(leftFaceState); // Triggers capture for LEFT -> completes workflow

    assert.ok(completedSession !== null);
    assert.equal(completedSession.status, 'COMPLETED');
    assert.equal(engine.currentState.status, 'SUCCESS');
  });
});
