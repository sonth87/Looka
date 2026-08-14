import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureStep, FaceState } from '@face/core';
import { StepEvaluator } from '../StepEvaluator.js';

/**
 * Pins the sign convention that ties three separate places together:
 * PoseEstimator produces the angle, the workflow step states a target, and the
 * evaluator turns the gap into an instruction.
 *
 * When the UP step's target had the wrong sign, each piece looked correct on
 * its own — the step could simply never be completed by doing what the screen
 * asked, because looking up moved the subject further from the target while the
 * hint told them to look down.
 *
 * Convention (see PoseEstimator): pitch > 0 is looking up, yaw > 0 is the
 * subject turning to their own right.
 */

function faceLookingAt(pose: { yaw?: number; pitch?: number; roll?: number }): FaceState {
  return {
    timestamp: 0,
    detected: true,
    faceCount: 1,
    presence: 'SINGLE_FACE',
    detection: {
      boundingBox: { x: 220, y: 120, width: 200, height: 240 },
      confidence: 0.95,
    },
    center: { x: 320, y: 240 },
    pose: { yaw: 0, pitch: 0, roll: 0, ...pose },
    frameWidth: 640,
    frameHeight: 480,
  } as FaceState;
}

/** Mirrors the shipped workflow: UP wants a positive pitch. */
const UP_STEP: CaptureStep = {
  id: 'step-up',
  type: 'UP',
  instruction: 'Ngẩng đầu lên',
  pose: { pitch: { target: 37.5, tolerance: 12.5 } },
  capture: { enabled: true },
} as CaptureStep;

const DOWN_STEP: CaptureStep = {
  id: 'step-down',
  type: 'DOWN',
  instruction: 'Cúi đầu xuống',
  pose: { pitch: { target: -37.5, tolerance: 12.5 } },
  capture: { enabled: true },
} as CaptureStep;

const evaluator = new StepEvaluator();

test('looking up satisfies the UP step', () => {
  const r = evaluator.evaluate(faceLookingAt({ pitch: 37.5 }), UP_STEP);
  assert.ok(!r.reasons.includes('LOOK_UP'), 'should not still be asking for more');
  assert.ok(!r.reasons.includes('LOOK_DOWN'), 'must never ask the subject to look down here');
});

test('looking down never satisfies the UP step', () => {
  const r = evaluator.evaluate(faceLookingAt({ pitch: -37.5 }), UP_STEP);
  assert.ok(r.reasons.includes('LOOK_UP'), 'the only sensible instruction is to look up');
});

test('a subject short of the UP target is told to look up, not down', () => {
  // The exact case from the field: head already raised, but not far enough.
  const r = evaluator.evaluate(faceLookingAt({ pitch: 17.5 }), UP_STEP);
  assert.ok(
    r.reasons.includes('LOOK_UP'),
    'a subject between neutral and the target must be asked to continue upward'
  );
  assert.ok(!r.reasons.includes('LOOK_DOWN'));
});

test('looking down satisfies the DOWN step', () => {
  const r = evaluator.evaluate(faceLookingAt({ pitch: -37.5 }), DOWN_STEP);
  assert.ok(!r.reasons.includes('LOOK_UP'));
  assert.ok(!r.reasons.includes('LOOK_DOWN'));
});

test('UP and DOWN targets have opposite signs', () => {
  const up = UP_STEP.pose?.pitch?.target ?? 0;
  const down = DOWN_STEP.pose?.pitch?.target ?? 0;
  assert.ok(up > 0, 'UP must be a positive pitch');
  assert.ok(down < 0, 'DOWN must be a negative pitch');
});

test('turning to the subject’s own right satisfies a RIGHT step', () => {
  const rightStep = {
    id: 'step-right',
    type: 'RIGHT',
    instruction: 'Quay mặt sang phải',
    pose: { yaw: { target: 65, tolerance: 25 } },
    capture: { enabled: true },
  } as CaptureStep;

  const ok = evaluator.evaluate(faceLookingAt({ yaw: 65 }), rightStep);
  assert.ok(!ok.reasons.includes('TURN_LEFT') && !ok.reasons.includes('TURN_RIGHT'));

  const wrongWay = evaluator.evaluate(faceLookingAt({ yaw: -65 }), rightStep);
  assert.ok(wrongWay.reasons.includes('TURN_RIGHT'), 'must be sent back the other way');
});
