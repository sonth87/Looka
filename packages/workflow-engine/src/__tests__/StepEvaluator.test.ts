import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StepEvaluator } from '../StepEvaluator.js';
import { CaptureStep, FaceState } from '@face/core';

describe('StepEvaluator posture gating', () => {
  const createMockFaceState = (yaw = 0): FaceState => ({
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: {
      // 320x320, not 320x240: on the 640x480 fallback frame (no frameWidth/
      // frameHeight set here), a 240px-tall box fails §2.8's 250px absolute
      // resolution floor and makes every quality check in this file fail for
      // a reason unrelated to what it actually tests (posture gating).
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
    posture: {
      shoulderRoll: 20,
      shouldersVisible: true,
      leveled: false,
      reasons: ['SHOULDERS_TILTED'],
    },
  });

  const leftStepWithPostureCheckDisabled: CaptureStep = {
    id: 'step-left',
    type: 'LEFT',
    instruction: 'Quay mặt sang trái',
    pose: { yaw: { target: -65, tolerance: 25 } },
    postureCheck: false,
    capture: { enabled: true },
  };

  const frontStepDefaultPostureCheck: CaptureStep = {
    id: 'step-front',
    type: 'FRONT',
    instruction: 'Nhìn thẳng vào camera',
    pose: { yaw: { target: 0, tolerance: 12 } },
    capture: { enabled: true },
  };

  test('postureCheck: false skips posture reasons and still passes', () => {
    const evaluator = new StepEvaluator();
    const faceState = createMockFaceState(-65); // within LEFT tolerance
    const result = evaluator.evaluate(faceState, leftStepWithPostureCheckDisabled);

    assert.equal(result.passed, true);
    assert.equal(result.postureValid, true);
    assert.ok(!result.reasons.includes('SHOULDERS_TILTED'));
  });

  test('default (postureCheck undefined) still enforces posture and fails', () => {
    const evaluator = new StepEvaluator();
    const faceState = createMockFaceState(0); // within FRONT tolerance
    const result = evaluator.evaluate(faceState, frontStepDefaultPostureCheck);

    assert.equal(result.passed, false);
    assert.equal(result.postureValid, false);
    assert.ok(result.reasons.includes('SHOULDERS_TILTED'));
  });

  test('postureCheck: false also skips SHOULDERS_NOT_VISIBLE and still passes', () => {
    const evaluator = new StepEvaluator();
    const faceState: FaceState = {
      ...createMockFaceState(-65),
      posture: {
        shoulderRoll: null,
        shouldersVisible: false,
        leveled: null,
        reasons: ['SHOULDERS_NOT_VISIBLE'],
      },
    };
    const result = evaluator.evaluate(faceState, leftStepWithPostureCheckDisabled);

    assert.equal(result.passed, true);
    assert.equal(result.postureValid, true);
    assert.ok(!result.reasons.includes('SHOULDERS_NOT_VISIBLE'));
  });
});

describe('StepEvaluator §2.8 absolute resolution floor — FRONT-only (product decision 2026-09-05)', () => {
  // 640x480 frame, no captureFrameWidth/Height override, so the frame passed
  // to QualityEvaluator IS the save resolution — a 90x90 box is comfortably
  // under MIN_FACE_RESOLUTION_PX (250) on both axes, while still clearing
  // every sensitivity preset's minFaceSizeRatio (90 / 640 = 0.14 > MEDIUM's
  // 0.10 floor) so FACE_TOO_SMALL never fires and the only reason in play is
  // FACE_RESOLUTION_TOO_LOW.
  const smallFaceState = (): FaceState => ({
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    frameWidth: 640,
    frameHeight: 480,
    detection: {
      boundingBox: { x: 275, y: 195, width: 90, height: 90 },
      confidence: 0.98,
    },
    pose: { yaw: -65, pitch: 0, roll: 0 },
    quality: {
      overallScore: 0.9,
      accepted: true,
      sharpness: 0.8,
      brightness: 0.7,
      faceSizeRatio: 0.14,
      centerXOffset: 0.02,
      centerYOffset: 0.01,
      eyeOpenScore: 0.9,
      smileScore: 0.05,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: true,
      faceWidthPx: 90,
      faceHeightPx: 90,
      reasons: [],
    },
    posture: {
      shoulderRoll: 0,
      shouldersVisible: true,
      leveled: true,
      reasons: [],
    },
  });

  const leftStep: CaptureStep = {
    id: 'step-left',
    type: 'LEFT',
    instruction: 'Quay mặt sang trái',
    pose: { yaw: { target: -65, tolerance: 25 } },
    postureCheck: false,
    capture: { enabled: true },
  };

  const frontStep: CaptureStep = {
    id: 'step-front',
    type: 'FRONT',
    instruction: 'Nhìn thẳng vào camera',
    pose: { yaw: { target: 0, tolerance: 12 } },
    capture: { enabled: true },
  };

  test('LEFT step with a small (<250px) face passes — the floor does not apply off-CENTER', () => {
    const evaluator = new StepEvaluator();
    const faceState = { ...smallFaceState(), pose: { yaw: -65, pitch: 0, roll: 0 } };
    const result = evaluator.evaluate(faceState, leftStep);

    assert.equal(result.passed, true);
    assert.equal(result.qualityValid, true);
    assert.equal(result.sizeValid, true);
    assert.ok(!result.reasons.includes('FACE_RESOLUTION_TOO_LOW'));
  });

  test('FRONT step with the same small (<250px) face still fails on the floor', () => {
    const evaluator = new StepEvaluator();
    const faceState = { ...smallFaceState(), pose: { yaw: 0, pitch: 0, roll: 0 } };
    const result = evaluator.evaluate(faceState, frontStep);

    assert.equal(result.passed, false);
    assert.equal(result.qualityValid, false);
    assert.equal(result.sizeValid, false);
    assert.ok(result.reasons.includes('FACE_RESOLUTION_TOO_LOW'));
  });

  test('a CUSTOM step explicitly mapped to cameraRole CENTER still gets the floor', () => {
    const evaluator = new StepEvaluator();
    const customCenterStep: CaptureStep = {
      id: 'step-custom-center',
      type: 'CUSTOM',
      instruction: 'Custom center capture',
      cameraRole: 'CENTER',
      postureCheck: false,
      capture: { enabled: true },
    };
    const result = evaluator.evaluate(smallFaceState(), customCenterStep);

    assert.ok(result.reasons.includes('FACE_RESOLUTION_TOO_LOW'));
  });
});

describe('StepEvaluator FRONT smile ceiling — strict regardless of sensitivity (product decision 2026-09-05, field report "cười vẫn cho chụp")', () => {
  // 320x320 on the 640x480 fallback frame (no frameWidth/frameHeight set):
  // ratio 0.5 clears MEDIUM's [0.10, 0.55] band and 320px clears the §2.8
  // 250px floor on both axes, so SMILING is the only reason that can fire.
  const faceStateWithSmile = (smileScore: number, yaw: number): FaceState => ({
    timestamp: Date.now(),
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: {
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
      smileScore,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: smileScore <= 0.4,
      faceWidthPx: 320,
      faceHeightPx: 320,
      reasons: [],
    },
    posture: {
      shoulderRoll: 0,
      shouldersVisible: true,
      leveled: true,
      reasons: [],
    },
  });

  // cameraRole defaults to CENTER for a FRONT step (defaultCameraRoleForStepType).
  const frontStep: CaptureStep = {
    id: 'step-front',
    type: 'FRONT',
    instruction: 'Nhìn thẳng vào camera',
    pose: { yaw: { target: 0, tolerance: 12 } },
    capture: { enabled: true },
  };

  const leftStep: CaptureStep = {
    id: 'step-left',
    type: 'LEFT',
    instruction: 'Quay mặt sang trái',
    pose: { yaw: { target: -65, tolerance: 25 } },
    postureCheck: false,
    capture: { enabled: true },
  };

  test("CENTER (FRONT) step rejects smileScore 0.35 at MEDIUM sensitivity — MEDIUM's own ceiling (0.40) would have passed it", () => {
    const evaluator = new StepEvaluator();
    const result = evaluator.evaluate(faceStateWithSmile(0.35, 0), frontStep, 'MEDIUM');

    assert.equal(result.passed, false);
    assert.equal(result.qualityValid, false);
    assert.ok(result.reasons.includes('SMILING'), result.reasons.join(','));
  });

  test('LEFT step with the same smileScore 0.35 at MEDIUM sensitivity passes — side angles keep the level ceiling', () => {
    const evaluator = new StepEvaluator();
    const result = evaluator.evaluate(faceStateWithSmile(0.35, -65), leftStep, 'MEDIUM');

    assert.equal(result.passed, true, result.reasons.join(','));
    assert.ok(!result.reasons.includes('SMILING'));
  });

  test('CENTER (FRONT) step with smileScore 0.15 at MEDIUM sensitivity passes — under the strict 0.30 ceiling', () => {
    const evaluator = new StepEvaluator();
    const result = evaluator.evaluate(faceStateWithSmile(0.15, 0), frontStep, 'MEDIUM');

    assert.equal(result.passed, true, result.reasons.join(','));
    assert.ok(!result.reasons.includes('SMILING'));
  });
});
