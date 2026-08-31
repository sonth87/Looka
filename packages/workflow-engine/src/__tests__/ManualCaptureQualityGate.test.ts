import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureStep, CaptureWorkflow, FaceState } from '@face/core';

/**
 * Regression coverage for "cười vẫn có thể cho chụp" (smiling still gets
 * captured).
 *
 * AUTO mode never had this hole: WorkflowEngine.processFrame always hands
 * triggerManualCapture() the exact faceState it just evaluated. But the
 * MANUAL (hand-gesture) and OFF (shutter button) triggers in FaceCaptureApp
 * call triggerManualCapture() from the UI layer, and used to call it with no
 * argument at all — which made CaptureController.validateCapturedImage()
 * treat the missing quality reading as "nothing to check" (see its `if
 * (policy.quality && ...)` guard) and wave the capture through no matter how
 * far past the smiling threshold the actual frame was. The fix makes
 * triggerManualCapture() fall back to the last frame the engine actually
 * processed, and re-derive the accept/reject decision itself from the
 * step-aware evaluator instead of trusting a caller-supplied verdict.
 */

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

/**
 * A face framed dead-on for `frontStep`/`strictStep` below (yaw/pitch/roll 0,
 * centred, comfortably within MEDIUM's size band), so only `smileScore`
 * varies between cases and nothing else can incidentally block the capture.
 *
 * `accepted`/`reasons` mimic the CV engine's own *generic* verdict (MEDIUM
 * sensitivity, no per-step override) — i.e. exactly what
 * MediaPipeCVEngine.processFrame would have produced. Defaulted from
 * `smileScore` against MEDIUM's 0.40 ceiling, but overridable so a test can
 * construct the "generic reading disagrees with this step's own requirement"
 * scenario on purpose.
 */
function smilingFaceState(smileScore: number, accepted?: boolean): FaceState {
  const genericAccepted = accepted ?? smileScore <= 0.4;
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
      overallScore: genericAccepted ? 0.9 : 0.5,
      accepted: genericAccepted,
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
      reasons: genericAccepted ? [] : ['SMILING'],
    },
  };
}

const frontStep: CaptureStep = {
  id: 'step-front',
  type: 'FRONT',
  instruction: 'Nhìn thẳng vào camera',
  capture: { enabled: true },
};

const workflow: CaptureWorkflow = {
  id: 'test-quality-gate',
  name: 'Test Quality Gate',
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

describe('WorkflowEngine.triggerManualCapture quality gate', () => {
  test('a MANUAL/OFF-style trigger with no faceState argument still blocks a smiling frame', async () => {
    const engine = createEngine();
    await engine.startSession(workflow);

    // Seeds the engine's "last known frame" the way the live CV pipeline
    // continuously does, without running long enough to reach AUTO-mode
    // stability itself (a single frame never does — see StabilityTracker).
    await engine.processFrame(smilingFaceState(0.75));

    // The actual bug: FaceCaptureApp's gesture loop and shutter handler used
    // to call this with no argument at all.
    const captured = await engine.triggerManualCapture();

    assert.equal(captured, false, 'a smiling frame must not complete the step');
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });

  test('a MANUAL/OFF-style trigger with no faceState argument still allows a neutral frame', async () => {
    const engine = createEngine();
    await engine.startSession(workflow);

    await engine.processFrame(smilingFaceState(0.05));
    const captured = await engine.triggerManualCapture();

    assert.equal(captured, true, 'a genuinely neutral frame must still be capturable');
    assert.equal(engine.currentSession?.steps[0].status, 'COMPLETED');
  });

  test('explicitly passing a smiling faceState is rejected too', async () => {
    const engine = createEngine();
    await engine.startSession(workflow);

    const captured = await engine.triggerManualCapture(smilingFaceState(0.9));

    assert.equal(captured, false);
    assert.equal(engine.currentSession?.steps[0].status, 'PENDING');
  });

  test("a step's own maxSmileScore gates the capture even when the generic quality reading disagrees", async () => {
    // This step tightens the smile ceiling below MEDIUM's default 0.40.
    const strictStep: CaptureStep = {
      id: 'step-strict',
      type: 'FRONT',
      instruction: 'Nhìn thẳng vào camera',
      quality: { maxSmileScore: 0.1 },
      capture: { enabled: true },
    };
    const engine = createEngine();
    await engine.startSession({
      id: 'test-strict-quality',
      name: 'Strict quality override',
      version: 1,
      steps: [strictStep],
    });

    // smileScore of 0.3 clears the generic MEDIUM ceiling (0.40, hence the
    // CV engine's own accepted: true) but fails this step's tighter one
    // (0.1) — exactly the disagreement a caller re-deriving "is this ok"
    // from the generic reading alone (as the gesture loop and shutter button
    // pre-checks do) could miss.
    const mild = smilingFaceState(0.3, true);
    const captured = await engine.triggerManualCapture(mild);

    assert.equal(
      captured,
      false,
      "the step's own maxSmileScore must gate the capture, not the generic accepted flag"
    );
  });

  test('a trigger with no faceState ever seen (e.g. the existing retake tests) is left ungated, unchanged', async () => {
    // Documents the deliberate compatibility rule: with nothing at all to
    // check against — no argument, and no prior processFrame call to fall
    // back on — the gate stays a no-op, matching every existing test that
    // calls triggerManualCapture() without ever simulating a camera frame.
    const engine = createEngine();
    await engine.startSession(workflow);

    const captured = await engine.triggerManualCapture();

    assert.equal(captured, true);
  });
});
