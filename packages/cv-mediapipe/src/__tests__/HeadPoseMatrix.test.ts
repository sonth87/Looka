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

/**
 * Regression coverage for the LEFT step being permanently unreachable.
 *
 * The round-trip tests above only prove poseFromTransformationMatrix and
 * transformationMatrixFromEuler agree with EACH OTHER — both live in this file
 * and share whatever sign convention they were written with, so a matching bug
 * in both would round-trip cleanly and still be wrong for a real camera. These
 * tests instead build the rotation matrix by hand, independently of
 * transformationMatrixFromEuler, straight from MediaPipe's documented camera
 * coordinate space: right-handed, camera looking down -Z, so X is image-right,
 * Y is up, Z points from the face towards the camera
 * (developers.googleblog.com/mediapipe-3d-face-transform).
 *
 * A pure rotation about Y by +theta swings the face's forward axis (+Z) toward
 * +X, i.e. the nose moves toward image-right. For a subject facing the camera,
 * image-right is THEIR OWN LEFT — the same relationship a photo has: someone
 * facing you has their left hand on your right. So theta > 0 here is a real,
 * physical turn to the subject's own left.
 */
describe('head pose yaw sign matches a real physical turn (regression)', () => {
  /**
   * Column-major 4x4 for a pure rotation about the world/camera Y axis,
   * built directly from the matrix definition rather than via
   * transformationMatrixFromEuler, so a shared bug between compose and
   * decompose cannot hide behind a passing round-trip.
   */
  function pureYawRotationMatrix(thetaDeg: number): number[] {
    const t = (thetaDeg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // Columns: [r00,r10,r20,0], [r01,r11,r21,0], [r02,r12,r22,0], [0,0,0,1]
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }

  test('nose swinging toward image-right (own-left turn) reads as negative yaw', () => {
    // theta = +65: the exact motion needed to satisfy step-left
    // (pose.yaw.target -65, tolerance 25 → accepts [-90, -40]) in
    // FaceCaptureApp.tsx's defaultWorkflow.
    const pose = poseFromTransformationMatrix(pureYawRotationMatrix(65));
    assert.ok(pose, 'expected a pose');
    assert.ok(
      pose!.yaw >= -90 && pose!.yaw <= -40,
      `a 65-degree turn to the subject's own left must satisfy the LEFT step (target -65 +/-25), got yaw ${pose!.yaw}`
    );
  });

  test('nose swinging toward image-left (own-right turn) reads as positive yaw', () => {
    // theta = -65: the mirror-image motion, matching step-right's target of
    // +65 (tolerance 25 → accepts [40, 90]).
    const pose = poseFromTransformationMatrix(pureYawRotationMatrix(-65));
    assert.ok(pose, 'expected a pose');
    assert.ok(
      pose!.yaw >= 40 && pose!.yaw <= 90,
      `a 65-degree turn to the subject's own right must satisfy the RIGHT step (target +65 +/-25), got yaw ${pose!.yaw}`
    );
  });

  test('turning further to the subject’s own left moves yaw further negative, never back positive', () => {
    // This is the exact shape of the field bug: turning further in the
    // "correct" direction has to get closer to the LEFT step's negative
    // target, not drift further away from it. A hard sign inversion is the
    // one failure mode where "turn further" never helps, no matter how far
    // the subject turns — which is what made the step permanently stuck.
    const readings = [10, 30, 50, 65, 80].map(
      (theta) => poseFromTransformationMatrix(pureYawRotationMatrix(theta))!.yaw
    );

    for (let i = 1; i < readings.length; i++) {
      assert.ok(
        readings[i] < readings[i - 1],
        `deeper left turns must read more negative: ${readings.join(', ')}`
      );
    }
    assert.ok(readings.every((y) => y < 0), `every own-left turn must read negative yaw, got ${readings.join(', ')}`);
  });

  test('agrees with the 2D fallback on sign: own-left turn is negative in both pose sources', () => {
    // PoseEstimator.test.ts independently pins "turning to their own LEFT
    // gives negative yaw" from pure image-space landmark geometry, with no
    // dependency on this file's matrix math. The 3D and 2D pose sources feed
    // the same EMA smoother in MediaPipeCVEngine and must never disagree on
    // sign, or a session that switches between them mid-capture (e.g. a
    // frame where MediaPipe fails to solve the matrix) would see the
    // reported yaw jump to the opposite side of zero.
    const pose = poseFromTransformationMatrix(pureYawRotationMatrix(30));
    assert.ok(pose!.yaw < 0, `expected the 3D path to agree with the 2D own-left convention (negative), got ${pose!.yaw}`);
  });
});
