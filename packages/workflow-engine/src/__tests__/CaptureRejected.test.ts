import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureStep, CaptureWorkflow, FaceState } from '@face/core';

/**
 * Coverage for the "capture rejected" diagnostics added to
 * `triggerManualCapture()` — a kiosk in the field showed the capture step
 * flash repeatedly and never advance, with no photo written and nothing in
 * the logs explaining why. These tests pin down that a rejection is now
 * always observable (via the `capture-rejected` event) and always
 * distinguishes "no snapshot at all" from "quality rejected, and why".
 */

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

const frontStep: CaptureStep = {
  id: 'step-front',
  type: 'FRONT',
  instruction: 'Nhìn thẳng vào camera',
  capture: { enabled: true },
};

const workflow: CaptureWorkflow = {
  id: 'test-capture-rejected',
  name: 'Test Capture Rejected',
  version: 1,
  steps: [frontStep, { ...frontStep, id: 'step-second' }],
};

/** A face framed dead-on for `frontStep`, so only `smileScore` decides accept/reject. */
function faceState(smileScore: number, accepted: boolean, reasons: string[] = []): FaceState {
  return {
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: {
      boundingBox: { x: 160, y: 72, width: 320, height: 336 },
      confidence: 0.98,
    },
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    quality: {
      overallScore: accepted ? 0.9 : 0.5,
      accepted,
      sharpness: 0.8,
      brightness: 0.6,
      faceSizeRatio: 320 / FRAME_WIDTH,
      centerXOffset: 0,
      centerYOffset: 0,
      eyeOpenScore: 0.9,
      smileScore,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: smileScore <= 0.4,
      faceWidthPx: 320,
      faceHeightPx: 336,
      reasons,
    },
  };
}

type CaptureRejectedPayload = {
  stepId: string;
  stepType: string;
  reason: string;
  qualityReasons?: string[];
  captureMode: string;
  attempts: number;
};

describe('WorkflowEngine capture-rejected diagnostics', () => {
  test('a null snapshot provider rejects with NO_SNAPSHOT, does not advance, and counts the attempt', async () => {
    const engine = new WorkflowEngine();
    engine.setSnapshotProvider(() => null);

    const rejections: CaptureRejectedPayload[] = [];
    engine.on('capture-rejected', (payload: CaptureRejectedPayload) => rejections.push(payload));

    await engine.startSession(workflow);
    assert.equal(engine.currentState.stepId, 'step-front');

    const captured = await engine.triggerManualCapture(faceState(0.05, true));

    assert.equal(captured, false);
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'NO_SNAPSHOT');
    assert.equal(rejections[0].stepId, 'step-front');
    assert.equal(rejections[0].stepType, 'FRONT');
    assert.equal(rejections[0].captureMode, 'AUTO');
    assert.equal(rejections[0].attempts, 1);

    // Step never advanced, and the attempt was recorded on the step it failed.
    assert.equal(engine.currentState.stepId, 'step-front');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
    assert.equal(engine.currentSession?.steps[0].attempts, 1);
  });

  test('a rejected quality reading rejects with QUALITY_REJECTED and the evaluator reasons', async () => {
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,${'a'.repeat(120)}shot${++shot}`);

    const rejections: CaptureRejectedPayload[] = [];
    engine.on('capture-rejected', (payload: CaptureRejectedPayload) => rejections.push(payload));

    await engine.startSession(workflow);

    // smileScore well past MEDIUM's ceiling -> the step-aware evaluator
    // rejects it and reports 'SMILING' among its own reasons (independent of
    // the generic reasons passed in on the faceState itself).
    const captured = await engine.triggerManualCapture(faceState(0.9, false, ['SMILING']));

    assert.equal(captured, false);
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'QUALITY_REJECTED');
    assert.ok(rejections[0].qualityReasons && rejections[0].qualityReasons.length > 0);
    assert.equal(rejections[0].attempts, 1);

    assert.equal(engine.currentState.stepId, 'step-front');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });
});
