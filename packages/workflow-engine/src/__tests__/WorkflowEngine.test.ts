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
      // 320x320, not 320x240: on the 640x480 fallback frame (no frameWidth/
      // frameHeight set here), a 240px-tall box fails §2.8's 250px absolute
      // resolution floor and blocks every step in this file for a reason
      // unrelated to what it actually tests (pose/stability advancement).
      boundingBox: { x: 160, y: 80, width: 320, height: 320 },
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
      eyeOpenScore: 0.9,
      smileScore: 0.05,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: true,
      faceWidthPx: 320,
      faceHeightPx: 320,
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
    let shot = 0;
    // Long enough to pass CaptureController's plausible-payload length floor —
    // a real capture's base64 payload runs to many kilobytes; this only needs
    // to be long enough that the check exercises the real code path rather
    // than always failing on payload length before the capture is even
    // wired into the workflow.
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,${'x'.repeat(120)}${++shot}`);

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
