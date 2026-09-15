import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureStep, CaptureWorkflow, FaceState } from '@face/core';

/**
 * Product decision 2026-09-15 ("chọn chế độ thủ công thì không cần tính
 * toán góc cạnh... hệ thống chỉ đưa ra gợi ý chứ không cản trở action"): in
 * EITHER operator-driven manual mode — `MANUAL` (gesture-triggered) or
 * `OFF` (on-screen shutter button; both read as "Thủ công" to the operator,
 * see `CAPTURE_MODE_LABEL` in `DeviceInitScreen.tsx`) — a step's own pose
 * target/tolerance must not block the save; only presence (a real, single
 * face), quality (brightness/sharpness/eyes/smile), and posture still gate.
 * AUTO alone keeps the full gate, pose included, unchanged. (Originally only
 * `MANUAL` was relaxed, leaving `OFF` on the strict AUTO-style gate — a real
 * field report confirmed the shutter-button half of "Thủ công" was still
 * being blocked by pose mismatches; fixed the same day this comment was
 * updated.)
 */

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

/** A face framed dead-on (yaw/pitch/roll 0) with otherwise-passing quality — deliberately never matches `leftStep`'s 30° yaw target below, so only the pose check varies between AUTO/MANUAL in these tests. */
function straightFaceState(): FaceState {
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
      overallScore: 0.9,
      accepted: true,
      sharpness: 0.8,
      brightness: 0.6,
      faceSizeRatio: 320 / FRAME_WIDTH,
      centerXOffset: 0,
      centerYOffset: 0,
      eyeOpenScore: 0.9,
      smileScore: 0.05,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: true,
      faceWidthPx: 320,
      faceHeightPx: 336,
      reasons: [],
    },
  };
}

/** No face detected at all — must still block in every mode, MANUAL included. */
function noFaceState(): FaceState {
  return {
    timestamp: Date.now(),
    detected: false,
    faceCount: 0,
    presence: 'NO_FACE',
    detection: null,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    pose: null,
    quality: null,
  } as unknown as FaceState;
}

const leftStep: CaptureStep = {
  id: 'step-left',
  type: 'LEFT',
  instruction: 'Quay đầu sang trái 30 độ',
  pose: { yaw: { target: 30, tolerance: 5 } },
  capture: { enabled: true },
};

function workflowWithStep(step: CaptureStep): CaptureWorkflow {
  return {
    id: 'test-manual-pose-gate',
    name: 'Test Manual Pose Gate',
    version: 1,
    steps: [step],
  };
}

const shotUrl = (n: number): string => `data:image/jpeg;base64,${'a'.repeat(120)}shot${n}`;

function createEngine(): WorkflowEngine {
  const engine = new WorkflowEngine();
  let shot = 0;
  engine.setSnapshotProvider(() => shotUrl(++shot));
  return engine;
}

describe('WorkflowEngine.triggerManualCapture MANUAL-mode pose bypass', () => {
  test('AUTO mode (default) still rejects a pose mismatch', async () => {
    const engine = createEngine();
    await engine.startSession(workflowWithStep(leftStep));

    const captured = await engine.triggerManualCapture(straightFaceState());

    assert.equal(captured, false, 'a straight-on face must not satisfy a 30° yaw target under AUTO');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });

  test('MANUAL mode accepts the same pose mismatch, as long as presence/quality pass', async () => {
    const engine = createEngine();
    engine.setCaptureTriggerConfig({ mode: 'MANUAL' });
    await engine.startSession(workflowWithStep(leftStep));

    const captured = await engine.triggerManualCapture(straightFaceState(), { source: 'GESTURE', gesture: 'WAVE' });

    assert.equal(captured, true, 'MANUAL mode must not block on the step\'s own pose target');
    assert.equal(engine.currentSession?.steps[0].status, 'COMPLETED');
  });

  test('MANUAL mode still rejects when there is no face at all', async () => {
    const engine = createEngine();
    engine.setCaptureTriggerConfig({ mode: 'MANUAL' });
    await engine.startSession(workflowWithStep(leftStep));

    const captured = await engine.triggerManualCapture(noFaceState(), { source: 'GESTURE', gesture: 'WAVE' });

    assert.equal(captured, false, 'MANUAL mode is not "always save no matter what" — presence still gates');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });

  test('OFF mode (shutter button) also accepts a pose mismatch, same as MANUAL', async () => {
    const engine = createEngine();
    engine.setCaptureTriggerConfig({ mode: 'OFF' });
    await engine.startSession(workflowWithStep(leftStep));

    const captured = await engine.triggerManualCapture(straightFaceState(), { source: 'SHUTTER' });

    assert.equal(captured, true, 'OFF (on-screen shutter) is operator-driven "Thủ công" too — must not block on the step\'s own pose target');
    assert.equal(engine.currentSession?.steps[0].status, 'COMPLETED');
  });

  test('OFF mode still rejects when there is no face at all', async () => {
    const engine = createEngine();
    engine.setCaptureTriggerConfig({ mode: 'OFF' });
    await engine.startSession(workflowWithStep(leftStep));

    const captured = await engine.triggerManualCapture(noFaceState(), { source: 'SHUTTER' });

    assert.equal(captured, false, 'OFF mode is not "always save no matter what" — presence still gates');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });
});
