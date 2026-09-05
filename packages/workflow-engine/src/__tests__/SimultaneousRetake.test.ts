import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../WorkflowEngine.js';
import { CaptureWorkflow, FaceState } from '@face/core';

/**
 * Coverage for retaking one angle in a simultaneous-capture session (§
 * desktop kiosk multi-camera capture, product decision 2026-09-05 #3:
 * "retaking one angle re-shoots only that angle"). `FaceCaptureApp.tsx`'s
 * `handleRetakeStep` drives this with `engine.retakeStep(stepId)` followed —
 * for a non-CENTER frame — by `engine.recordExternalCapture(stepId, ...)`
 * (a side frame has no shutter/gesture/AUTO trigger of its own to wait on);
 * a CENTER retake instead waits for a real capture through the normal
 * trigger path, which re-fires `recordExternalCapture` for every *other*,
 * still-COMPLETED frame and must leave every one of them untouched.
 *
 * Regression test for a real bug found while implementing that product
 * decision: `retakeStep` left the retaken step's own `status` at
 * `COMPLETED`, which `recordExternalCapture`'s own "already COMPLETED"
 * guard then rejected outright — silently, since `handleRetakeStep` does not
 * check that call's return value. A side-frame retake reported success but
 * never actually replaced the photo. Fixed in `retakeStep` (resets the
 * retaken step's `status` to `PENDING`, `capturedImagePath` untouched).
 */
describe('WorkflowEngine simultaneous-capture retake', () => {
  const threeFrameWorkflow: CaptureWorkflow = {
    id: 'test-simultaneous-retake',
    name: 'Test Simultaneous Retake',
    version: 1,
    steps: [
      { id: 'step-center', type: 'FRONT', instruction: 'Nhìn thẳng vào camera', capture: { enabled: true } },
      { id: 'step-left', type: 'LEFT', instruction: 'Camera trái', capture: { enabled: true } },
      { id: 'step-right', type: 'RIGHT', instruction: 'Camera phải', capture: { enabled: true } },
    ],
  };

  const stepOf = (engine: WorkflowEngine, stepId: string) =>
    engine.currentSession!.steps.find((s) => s.stepId === stepId)!;

  test('retaking a side frame lets recordExternalCapture replace only that frame\'s photo', async () => {
    const engine = new WorkflowEngine();
    await engine.startSession(threeFrameWorkflow);

    // Initial simultaneous shot: one shutter press feeds every frame.
    assert.equal(engine.recordExternalCapture('step-center', 'img://center-1'), true);
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-1'), true);
    assert.equal(engine.recordExternalCapture('step-right', 'img://right-1'), true);
    assert.equal(engine.currentSession?.status, 'COMPLETED');

    // Retake the LEFT frame only — the exact sequence handleRetakeStep uses
    // for a non-CENTER frame in simultaneous mode.
    assert.equal(await engine.retakeStep('step-left'), true);
    assert.equal(engine.currentSession?.status, 'RUNNING');

    // The bug: this used to return false and leave the old photo in place.
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-2'), true);

    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left-2');
    assert.equal(stepOf(engine, 'step-left').status, 'COMPLETED');
    // Neither sibling frame was touched by the retake.
    assert.equal(stepOf(engine, 'step-center').capturedImagePath, 'img://center-1');
    assert.equal(stepOf(engine, 'step-right').capturedImagePath, 'img://right-1');
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  });

  test('retaking CENTER and recompleting it does not re-touch the still-COMPLETED side frames', async () => {
    const engine = new WorkflowEngine();
    await engine.startSession(threeFrameWorkflow);

    assert.equal(engine.recordExternalCapture('step-center', 'img://center-1'), true);
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-1'), true);
    assert.equal(engine.recordExternalCapture('step-right', 'img://right-1'), true);

    assert.equal(await engine.retakeStep('step-center'), true);
    assert.equal(stepOf(engine, 'step-center').status, 'PENDING');
    // Side frames are still COMPLETED — a CENTER retake alone must not touch them.
    assert.equal(stepOf(engine, 'step-left').status, 'COMPLETED');
    assert.equal(stepOf(engine, 'step-right').status, 'COMPLETED');

    // CENTER's own retake completing (its normal, non-external path).
    assert.equal(engine.recordExternalCapture('step-center', 'img://center-2'), true);

    // The exact fan-out FaceCaptureApp's capture-trigger handler performs
    // for every OTHER frame on a CENTER capture — already-COMPLETED side
    // frames must reject a second recording attempt outright.
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-should-not-land'), false);
    assert.equal(engine.recordExternalCapture('step-right', 'img://right-should-not-land'), false);

    assert.equal(stepOf(engine, 'step-center').capturedImagePath, 'img://center-2');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left-1');
    assert.equal(stepOf(engine, 'step-right').capturedImagePath, 'img://right-1');
  });

  // ── retakeStep's `externalCapture` option ─────────────────────────────────
  //
  // Product decision 2026-09-05 #3, second pass: a side-frame retake must
  // return the operator to a live capture screen and let the shutter (OFF),
  // a gesture (MANUAL) or a held pose (AUTO) trigger the replacement — not
  // snapshot instantly with no gate (the original bug FaceCaptureApp.tsx's
  // handleRetakeStep had). All three trigger modes must end up snapshotting
  // the retaken frame's own physical camera, never this engine's own
  // snapshot provider (which only ever reads the CENTER-analysed camera) —
  // see `externalCaptureOnly`'s own doc comment in WorkflowEngine.ts.
  // FaceCaptureApp routes OFF/MANUAL itself before ever calling
  // triggerManualCapture; AUTO's auto-fire lives inside processFrame, so
  // that path is what these tests actually exercise.

  const createMockFaceState = (): FaceState => ({
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: { boundingBox: { x: 160, y: 80, width: 320, height: 320 }, confidence: 0.98 },
    pose: { yaw: 0, pitch: 0, roll: 0 },
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

  const stableThreeFrameWorkflow: CaptureWorkflow = {
    id: 'test-simultaneous-retake-auto',
    name: 'Test Simultaneous Retake (AUTO)',
    version: 1,
    steps: [
      {
        id: 'step-center',
        type: 'FRONT',
        instruction: 'Nhìn thẳng vào camera',
        stability: { durationMs: 50 },
        capture: { enabled: true },
      },
      {
        id: 'step-left',
        type: 'LEFT',
        instruction: 'Camera trái',
        stability: { durationMs: 50 },
        capture: { enabled: true },
      },
      {
        id: 'step-right',
        type: 'RIGHT',
        instruction: 'Camera phải',
        stability: { durationMs: 50 },
        capture: { enabled: true },
      },
    ],
  };

  test('AUTO mode: retaking a side frame with externalCapture emits external-capture-ready instead of capturing itself', async () => {
    const engine = new WorkflowEngine();
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,${'x'.repeat(150)}`);
    engine.setCaptureTriggerConfig({ mode: 'AUTO' });
    await engine.startSession(stableThreeFrameWorkflow);

    engine.recordExternalCapture('step-center', 'img://center-1');
    engine.recordExternalCapture('step-left', 'img://left-1');
    engine.recordExternalCapture('step-right', 'img://right-1');
    assert.equal(engine.currentSession?.status, 'COMPLETED');

    const externalReadyEvents: string[] = [];
    engine.on('external-capture-ready', (data: { stepId: string }) => externalReadyEvents.push(data.stepId));
    const captureTriggerEvents: string[] = [];
    engine.on('capture-trigger', (data: { stepId: string }) => captureTriggerEvents.push(data.stepId));

    assert.equal(await engine.retakeStep('step-left', { externalCapture: true }), true);
    assert.equal(engine.retakingStepId, 'step-left');

    const faceState = createMockFaceState();
    await engine.processFrame(faceState); // frame 1: starts the stability hold
    await new Promise((r) => setTimeout(r, 60));
    await engine.processFrame(faceState); // frame 2: stability reached

    // The engine must ask the caller to supply the photo, not take one itself.
    assert.deepEqual(externalReadyEvents, ['step-left']);
    assert.deepEqual(captureTriggerEvents, []);
    assert.equal(stepOf(engine, 'step-left').status, 'PENDING');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left-1');

    // The caller (FaceCaptureApp) supplies the actual snapshot from the side
    // frame's own video element.
    assert.equal(engine.recordExternalCapture('step-left', 'img://left-2'), true);
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left-2');
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  });

  test('triggerManualCapture is a no-op while externalCaptureOnly is set (defence in depth)', async () => {
    const engine = new WorkflowEngine();
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,${'x'.repeat(150)}`);
    await engine.startSession(threeFrameWorkflow);

    engine.recordExternalCapture('step-center', 'img://center-1');
    engine.recordExternalCapture('step-left', 'img://left-1');
    engine.recordExternalCapture('step-right', 'img://right-1');

    await engine.retakeStep('step-left', { externalCapture: true });

    // Even if a call site forgot to route away from it, this must never
    // complete the step from the wrong (CENTER) camera.
    assert.equal(await engine.triggerManualCapture(createMockFaceState()), false);
    assert.equal(stepOf(engine, 'step-left').status, 'PENDING');
    assert.equal(stepOf(engine, 'step-left').capturedImagePath, 'img://left-1');
  });

  test("externalCaptureOnly does not leak into a later, unrelated retake", async () => {
    // Regression: once the side-frame retake above completes, a LATER
    // CENTER retake (the normal path, no externalCapture option) must not
    // be silently suppressed by a stale flag left over from the first one.
    const engine = new WorkflowEngine();
    let shot = 0;
    engine.setSnapshotProvider(() => `data:image/jpeg;base64,${'x'.repeat(150)}${++shot}`);
    await engine.startSession(threeFrameWorkflow);

    engine.recordExternalCapture('step-center', 'img://center-1');
    engine.recordExternalCapture('step-left', 'img://left-1');
    engine.recordExternalCapture('step-right', 'img://right-1');

    await engine.retakeStep('step-left', { externalCapture: true });
    engine.recordExternalCapture('step-left', 'img://left-2');
    assert.equal(engine.currentSession?.status, 'COMPLETED');

    assert.equal(await engine.retakeStep('step-center'), true);
    assert.equal(await engine.triggerManualCapture(createMockFaceState()), true);
    assert.ok(stepOf(engine, 'step-center').capturedImagePath?.startsWith('data:image/jpeg;base64,'));
    assert.equal(engine.currentSession?.status, 'COMPLETED');
  });
});
