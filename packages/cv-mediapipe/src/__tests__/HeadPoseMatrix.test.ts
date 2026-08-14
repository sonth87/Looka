import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  poseFromTransformationMatrix,
  transformationMatrixFromEuler,
} from '../HeadPoseMatrix.js';

/**
 * The decomposition is checked against rotations whose angles are known because
 * the test built them, so the maths is pinned without needing a camera.
 *
 * Which physical direction MediaPipe calls positive cannot be derived here — it
 * was confirmed on the deployed kiosk, where a comfortably bowed head reported
 * -24 degrees. The case below records that reading so a future change to the
 * sign mapping fails loudly instead of quietly inverting every capture.
 */
describe('head pose from the transformation matrix', () => {
  const cases: Array<[string, number, number, number]> = [
    ['neutral', 0, 0, 0],
    ['looking up', 20, 0, 0],
    ['looking down', -25, 0, 0],
    ['turned to their own right', 0, 30, 0],
    ['turned to their own left', 0, -30, 0],
    ['tilted', 0, 0, 15],
    ['combined', -18, 22, -12],
  ];

  for (const [name, pitch, yaw, roll] of cases) {
    test(`${name} round-trips`, () => {
      const m = transformationMatrixFromEuler(pitch, yaw, roll);
      const pose = poseFromTransformationMatrix(m);
      assert.ok(pose, 'expected a pose');
      assert.ok(Math.abs(pose!.pitch - pitch) < 0.2, `pitch ${pose!.pitch} vs ${pitch}`);
      assert.ok(Math.abs(pose!.yaw - yaw) < 0.2, `yaw ${pose!.yaw} vs ${yaw}`);
      assert.ok(Math.abs(pose!.roll - roll) < 0.2, `roll ${pose!.roll} vs ${roll}`);
    });
  }

  test('a bowed head reads a full angle, not the sliver the 2D proxy managed', () => {
    // The heuristic reported about -4 degrees for a clearly bowed head because
    // it measured the nose sliding a fraction of a percent down the image. The
    // solved pose reported -24 for the same pose on real hardware.
    const pose = poseFromTransformationMatrix(transformationMatrixFromEuler(-25, 0, 0));
    assert.ok(pose!.pitch < -20, `expected a clear downward angle, got ${pose!.pitch}`);
  });

  test('bowing the head is negative pitch, as measured in the field', () => {
    // Pins the sign against a reading taken from the running kiosk. Flipping it
    // would make the UP and DOWN steps ask for the opposite of what they say,
    // which is exactly the failure this replaced.
    const bowed = poseFromTransformationMatrix(transformationMatrixFromEuler(-24, 0, 0))!;
    const raised = poseFromTransformationMatrix(transformationMatrixFromEuler(24, 0, 0))!;

    assert.ok(bowed.pitch < 0, `bowing must be negative, got ${bowed.pitch}`);
    assert.ok(raised.pitch > 0, `raising must be positive, got ${raised.pitch}`);

    const DOWN_STEP = { target: -25, tolerance: 10 };
    assert.ok(
      Math.abs(bowed.pitch - DOWN_STEP.target) <= DOWN_STEP.tolerance,
      `a comfortable bow at ${bowed.pitch} must satisfy the DOWN step`
    );
  });

  test('missing or malformed input yields no pose rather than a plausible one', () => {
    assert.equal(poseFromTransformationMatrix(null), null);
    assert.equal(poseFromTransformationMatrix(undefined), null);
    assert.equal(poseFromTransformationMatrix([1, 2, 3]), null);
    // Scaled columns are not a rotation; trusting them would report an angle
    // derived from something that never described an orientation.
    assert.equal(poseFromTransformationMatrix(new Array(16).fill(0)), null);
  });

  test('angles stay inside the range FacePose documents', () => {
    const pose = poseFromTransformationMatrix(transformationMatrixFromEuler(-80, 70, -60));
    assert.ok(Math.abs(pose!.pitch) <= 90);
    assert.ok(Math.abs(pose!.yaw) <= 90);
    assert.ok(Math.abs(pose!.roll) <= 90);
  });
});
