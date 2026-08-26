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
      eyeOpenScore: 0.9,
      smileScore: 0.05,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      neutralExpression: true,
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
