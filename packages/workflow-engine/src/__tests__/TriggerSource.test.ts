import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureStep, CaptureWorkflow, FaceState } from '@face/core';

/**
 * Coverage for the `triggerSource`/`gesture` fields on the `capture-trigger`
 * event (discussion doc §3.7.1/§3.7.2) — pure additive plumbing mapping each
 * of the four ways a step actually completes to `CaptureTriggerSource`:
 *
 *   AUTO_STABILITY_REACHED   -> 'AUTO'      (processFrame's own auto-fire)
 *   MANUAL_GESTURE_<X>       -> 'GESTURE'   (caller passes { source: 'GESTURE', gesture: X })
 *   SHUTTER_BUTTON_CLICKED   -> 'SHUTTER'   (caller passes { source: 'SHUTTER' })
 *   (side-frame capture)     -> 'EXTERNAL'  (recordExternalCapture, always)
 *
 * None of these tests touch capture-decision logic — only what ends up on
 * the emitted payload.
 */

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

/** A face framed dead-on, comfortably passing every gate at MEDIUM sensitivity. */
function neutralFaceState(yaw = 0): FaceState {
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
    pose: { yaw, pitch: 0, roll: 0 },
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

const frontStep: CaptureStep = {
  id: 'step-front',
  type: 'FRONT',
  instruction: 'Nhìn thẳng vào camera',
  pose: { yaw: { target: 0, tolerance: 10 } },
  stability: { durationMs: 50 },
  capture: { enabled: true },
};

const twoStepWorkflow: CaptureWorkflow = {
  id: 'test-trigger-source',
  name: 'Test Trigger Source',
  version: 1,
  steps: [frontStep, { ...frontStep, id: 'step-second' }],
};

const shotUrl = (n: number): string => `data:image/jpeg;base64,${'a'.repeat(120)}shot${n}`;

function createEngine(): WorkflowEngine {
  const engine = new WorkflowEngine();
  let shot = 0;
  engine.setSnapshotProvider(() => shotUrl(++shot));
  return engine;
}

describe('capture-trigger payload: triggerSource mapping', () => {
  test('AUTO_STABILITY_REACHED -> AUTO (processFrame auto-fire, no gesture field)', async () => {
    const engine = createEngine();
    const events: any[] = [];
    engine.on('capture-trigger', (payload: any) => events.push(payload));

    await engine.startSession(twoStepWorkflow);
    await engine.processFrame(neutralFaceState());
    await new Promise((r) => setTimeout(r, 60));
    await engine.processFrame(neutralFaceState()); // stability reached -> auto capture

    assert.equal(events.length, 1);
    assert.equal(events[0].triggerSource, 'AUTO');
    assert.equal(events[0].stepId, 'step-front');
    assert.equal('gesture' in events[0], false);
  });

  test('MANUAL_GESTURE_<X> -> GESTURE, carries the gesture name', async () => {
    const engine = createEngine();
    const events: any[] = [];
    engine.on('capture-trigger', (payload: any) => events.push(payload));

    await engine.startSession(twoStepWorkflow);
    const captured = await engine.triggerManualCapture(neutralFaceState(), {
      source: 'GESTURE',
      gesture: 'VICTORY',
    });

    assert.equal(captured, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].triggerSource, 'GESTURE');
    assert.equal(events[0].gesture, 'VICTORY');
  });

  test('SHUTTER_BUTTON_CLICKED -> SHUTTER, no gesture field', async () => {
    const engine = createEngine();
    const events: any[] = [];
    engine.on('capture-trigger', (payload: any) => events.push(payload));

    await engine.startSession(twoStepWorkflow);
    const captured = await engine.triggerManualCapture(neutralFaceState(), { source: 'SHUTTER' });

    assert.equal(captured, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].triggerSource, 'SHUTTER');
    assert.equal('gesture' in events[0], false);
  });

  test('recordExternalCapture always reports EXTERNAL', async () => {
    const engine = createEngine();
    const events: any[] = [];
    engine.on('capture-trigger', (payload: any) => events.push(payload));

    await engine.startSession(twoStepWorkflow);
    const recorded = engine.recordExternalCapture('step-front', 'img://side-camera');

    assert.equal(recorded, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].triggerSource, 'EXTERNAL');
    assert.equal(events[0].imagePath, 'img://side-camera');
  });

  test('omitting the trigger info on triggerManualCapture defaults to AUTO (back-compat)', async () => {
    const engine = createEngine();
    const events: any[] = [];
    engine.on('capture-trigger', (payload: any) => events.push(payload));

    await engine.startSession(twoStepWorkflow);
    const captured = await engine.triggerManualCapture(neutralFaceState());

    assert.equal(captured, true);
    assert.equal(events[0].triggerSource, 'AUTO');
  });
});
