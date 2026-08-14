import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PoseEstimator } from '../PoseEstimator.js';
import { FaceLandmark } from '@face/core';

/**
 * Landmarks are built in IMAGE space: x rises towards the right of the image.
 * Poses are reported in SUBJECT space: yaw < 0 means the person turned towards
 * their own left. The two are mirror images of each other, which is exactly the
 * confusion these tests exist to pin down.
 *
 * Proportions follow an average adult face rather than round numbers, because
 * the estimator converts landmark offsets into degrees using anatomy: outer eye
 * corners about 90 mm apart, nose tip 48 mm below the eye line, chin 120 mm
 * below it. A fixture with arbitrary spacing would read as a permanent head
 * tilt and quietly invalidate every angle asserted here.
 */
const FRAME_W = 1280;
const FRAME_H = 720;
const ASPECT = FRAME_W / FRAME_H;

/** Outer eye corners, as a fraction of frame width. */
const EYE_SPAN_X = 0.2;
/** The same span expressed in vertical units, which is what the maths compares against. */
const EYE_SPAN_Y = EYE_SPAN_X * ASPECT;

const EYE_Y = 0.35;
const NEUTRAL_NOSE_Y = EYE_Y + (48 / 90) * EYE_SPAN_Y;
const CHIN_Y = EYE_Y + (120 / 90) * EYE_SPAN_Y;

const createLandmarks = (
  opts: { noseX?: number; noseY?: number; chinY?: number } = {}
): FaceLandmark[] => {
  const { noseX = 0.5, noseY = NEUTRAL_NOSE_Y, chinY = CHIN_Y } = opts;
  const landmarks: FaceLandmark[] = new Array(460)
    .fill(null)
    .map(() => ({ x: 0.5, y: 0.5, z: 0 }));

  landmarks[1] = { x: noseX, y: noseY, z: 0 };                         // nose tip
  landmarks[33] = { x: 0.5 - EYE_SPAN_X / 2, y: EYE_Y, z: 0 };         // eye, image-left
  landmarks[263] = { x: 0.5 + EYE_SPAN_X / 2, y: EYE_Y, z: 0 };        // eye, image-right
  landmarks[234] = { x: 0.37, y: 0.5, z: 0 };                          // cheek, image-left
  landmarks[454] = { x: 0.63, y: 0.5, z: 0 };                          // cheek, image-right
  landmarks[152] = { x: 0.5, y: chinY, z: 0 };                         // chin

  return landmarks;
};

/** An estimator told the real frame shape, without smoothing. */
const estimator = () => {
  const e = new PoseEstimator({ alpha: 1.0 });
  e.setFrameSize(FRAME_W, FRAME_H);
  return e;
};

/** Nose drop that should read as `deg` degrees of pitch. */
const noseYForPitch = (deg: number) => {
  const gain = 90 / 20 / (Math.PI / 180);
  return EYE_Y + (48 / 90 - deg / gain) * EYE_SPAN_Y;
};

/** Turning towards their own left points the face at image-right: nose.x rises. */
const facingOwnLeft = (amount = 0.1) => createLandmarks({ noseX: 0.5 + amount });
/** Turning towards their own right points the face at image-left: nose.x falls. */
const facingOwnRight = (amount = 0.1) => createLandmarks({ noseX: 0.5 - amount });

/** Move the whole face towards or away from the camera, about its own centre. */
const atDistanceScale = (factor: number, base: FaceLandmark[]): FaceLandmark[] => {
  const cx = 0.5;
  const cy = (EYE_Y + CHIN_Y) / 2;
  return base.map((lm) => ({
    ...lm,
    x: cx + (lm.x - cx) * factor,
    y: cy + (lm.y - cy) * factor,
  }));
};

describe('PoseEstimator — yaw sign convention', () => {
  test('a centred face reads as neutral', () => {
    const pose = estimator().estimateRawPose(createLandmarks());
    assert.ok(Math.abs(pose.yaw) < 5, `expected ~0 yaw, got ${pose.yaw}`);
    assert.ok(Math.abs(pose.pitch) < 5, `expected ~0 pitch, got ${pose.pitch}`);
    assert.ok(Math.abs(pose.roll) < 5, `expected ~0 roll, got ${pose.roll}`);
  });

  test('turning to their own LEFT gives negative yaw — matches LEFT_15 = -15', () => {
    const pose = estimator().estimateRawPose(facingOwnLeft());
    assert.ok(pose.yaw < -10, `expected yaw < -10, got ${pose.yaw}`);
  });

  test('turning to their own RIGHT gives positive yaw — matches RIGHT_15 = +15', () => {
    const pose = estimator().estimateRawPose(facingOwnRight());
    assert.ok(pose.yaw > 10, `expected yaw > 10, got ${pose.yaw}`);
  });

  test('yaw magnitude grows with the turn', () => {
    const e = estimator();
    const small = e.estimateRawPose(facingOwnLeft(0.05));
    const large = e.estimateRawPose(facingOwnLeft(0.15));
    assert.ok(Math.abs(large.yaw) > Math.abs(small.yaw));
    assert.equal(Math.sign(large.yaw), Math.sign(small.yaw));
  });
});

describe('PoseEstimator — mirrored preview', () => {
  test('a mirrored frame reports the same subject-space yaw as an unmirrored one', () => {
    // A kiosk usually mirrors the preview. The same physical turn then appears on
    // the opposite side of the image, and without this flag every angle would be
    // labelled backwards.
    const direct = estimator().estimateRawPose(facingOwnLeft());

    const mirroredEstimator = new PoseEstimator({ alpha: 1.0, mirrored: true });
    mirroredEstimator.setFrameSize(FRAME_W, FRAME_H);
    const mirrored = mirroredEstimator.estimateRawPose(facingOwnRight());

    assert.ok(direct.yaw < 0);
    assert.ok(mirrored.yaw < 0, `mirrored estimator should also report a left turn, got ${mirrored.yaw}`);
    assert.equal(direct.yaw, mirrored.yaw);
  });
});

describe('PoseEstimator — pitch sign convention', () => {
  test('looking up gives positive pitch — matches UP_10 = +10', () => {
    const up = estimator().estimateRawPose(createLandmarks({ noseY: noseYForPitch(10) }));
    assert.ok(up.pitch > 0, `expected positive pitch, got ${up.pitch}`);
    assert.ok(Math.abs(up.pitch - 10) < 2, `expected about 10 degrees, got ${up.pitch}`);
  });

  test('looking down gives negative pitch', () => {
    const down = estimator().estimateRawPose(createLandmarks({ noseY: noseYForPitch(-20) }));
    assert.ok(down.pitch < 0, `expected negative pitch, got ${down.pitch}`);
    assert.ok(Math.abs(down.pitch + 20) < 2, `expected about -20 degrees, got ${down.pitch}`);
  });

  test('a tucked chin does not disturb the reading', () => {
    // Looking down foreshortens the lower face until the chin projects close to
    // the eye line. While pitch was measured against eye-to-chin height, that
    // shrinking denominator amplified landmark noise without limit and the
    // reading could no longer be held steady long enough to pass the step.
    const e = estimator();
    const nose = noseYForPitch(-20);

    const relaxed = e.estimateRawPose(createLandmarks({ noseY: nose, chinY: CHIN_Y }));
    const tucked = e.estimateRawPose(
      createLandmarks({ noseY: nose, chinY: EYE_Y + 0.01 })
    );

    assert.ok(
      Math.abs(relaxed.pitch - tucked.pitch) < 1,
      `chin position moved pitch from ${relaxed.pitch} to ${tucked.pitch}`
    );
    assert.ok(Number.isFinite(tucked.pitch));
  });
});

describe('PoseEstimator — distance independence', () => {
  test('standing closer does not change the reported pose', () => {
    // The same head at a different distance is the same head. A measure that
    // drifts with face size makes a step pass at one distance and fail at
    // another, which is indistinguishable from the detection being broken.
    const e = estimator();
    const near = e.estimateRawPose(atDistanceScale(1.6, createLandmarks({ noseY: noseYForPitch(-20) })));
    const far = e.estimateRawPose(atDistanceScale(0.6, createLandmarks({ noseY: noseYForPitch(-20) })));

    assert.ok(Math.abs(near.pitch - far.pitch) < 1, `pitch ${near.pitch} vs ${far.pitch}`);
    assert.ok(Math.abs(near.yaw - far.yaw) < 1, `yaw ${near.yaw} vs ${far.yaw}`);
  });

  test('a far face still reports a usable turn', () => {
    const e = estimator();
    const far = e.estimateRawPose(atDistanceScale(0.5, facingOwnRight(0.1)));
    assert.ok(far.yaw > 10, `expected a clear right turn at distance, got ${far.yaw}`);
  });
});

describe('PoseEstimator — EMA smoothing', () => {
  test('a smoothed value lands between the previous pose and the new raw one', () => {
    const e = new PoseEstimator(0.5);
    e.setFrameSize(FRAME_W, FRAME_H);

    const first = e.estimatePose(createLandmarks()); // neutral
    const second = e.estimatePose(facingOwnLeft(0.15));

    assert.ok(Math.abs(first.yaw) < 5);
    // Moves towards the turn without jumping straight to it.
    assert.ok(second.yaw < first.yaw, 'should move towards the negative (own-left) turn');

    const raw = estimator().estimateRawPose(facingOwnLeft(0.15));
    assert.ok(second.yaw > raw.yaw, 'should not reach the raw value in one step');
  });

  test('alpha = 1.0 disables smoothing', () => {
    const e = estimator();
    e.estimatePose(createLandmarks());
    const smoothed = e.estimatePose(facingOwnLeft(0.15));
    const raw = estimator().estimateRawPose(facingOwnLeft(0.15));
    assert.equal(smoothed.yaw, raw.yaw);
  });

  test('reset clears the smoothing history', () => {
    const e = new PoseEstimator(0.5);
    e.setFrameSize(FRAME_W, FRAME_H);
    e.estimatePose(facingOwnLeft(0.15));
    e.reset();

    const afterReset = e.estimatePose(facingOwnLeft(0.15));
    const raw = estimator().estimateRawPose(facingOwnLeft(0.15));
    assert.equal(afterReset.yaw, raw.yaw, 'first pose after a reset should not be blended');
  });
});

describe('PoseEstimator — axis scaling and cross-talk', () => {
  /**
   * Rotate landmarks about the face centre by a real, physical angle.
   *
   * Done in pixel space and normalised afterwards, because that is what a real
   * camera produces: the rotation is a true rotation of the head, not of the
   * normalised coordinates, which are stretched differently on each axis.
   */
  const tiltHeadBy = (degrees: number, base: FaceLandmark[]): FaceLandmark[] => {
    const rad = (degrees * Math.PI) / 180;
    const cx = 0.5 * FRAME_W;
    const cy = 0.5 * FRAME_H;
    return base.map((lm) => {
      const px = lm.x * FRAME_W - cx;
      const py = lm.y * FRAME_H - cy;
      return {
        ...lm,
        x: (cx + px * Math.cos(rad) - py * Math.sin(rad)) / FRAME_W,
        y: (cy + px * Math.sin(rad) + py * Math.cos(rad)) / FRAME_H,
      };
    });
  };

  test('roll reports the real tilt, not one stretched by the frame shape', () => {
    const pose = estimator().estimateRawPose(tiltHeadBy(15, createLandmarks()));

    // Before the fix this read about 25 degrees: atan2 was fed x normalised by
    // width against y normalised by height, inflating every angle by 1280/720.
    assert.ok(Math.abs(pose.roll - 15) < 3, `expected roll near 15, got ${pose.roll}`);
  });

  test('tilting the head does not invent a sideways turn', () => {
    const e = estimator();
    const straight = e.estimateRawPose(createLandmarks());
    const tilted = e.estimateRawPose(tiltHeadBy(20, createLandmarks()));

    // Yaw used to be built from full 2D nose-to-cheek distances, so a tilt
    // changed the vertical part of those distances and leaked into the turn
    // reading — a head that had not turned at all reported one that had.
    assert.ok(
      Math.abs(tilted.yaw - straight.yaw) < 8,
      `tilting moved yaw from ${straight.yaw} to ${tilted.yaw}`
    );
  });

  test('a real turn still registers when the head is also tilted', () => {
    const pose = estimator().estimateRawPose(tiltHeadBy(15, facingOwnRight(0.12)));
    assert.ok(pose.yaw > 10, `expected a clear right turn, got ${pose.yaw}`);
  });
});
