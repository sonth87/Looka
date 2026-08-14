import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateDistance,
  faceSizeRatioAtDistance,
  zoomFactorToReach,
  DEFAULT_FACE_WIDTH_M,
} from '../DistanceEstimator.js';

const FRAME_W = 1280;
const boxOfRatio = (r: number) => ({
  x: Math.round((FRAME_W - r * FRAME_W) / 2),
  y: 100,
  width: Math.round(r * FRAME_W),
  height: Math.round(r * FRAME_W * 1.3),
});

test('a face filling more of the frame is nearer', () => {
  const near = estimateDistance(boxOfRatio(0.3), FRAME_W)!;
  const far = estimateDistance(boxOfRatio(0.1), FRAME_W)!;
  assert.ok(near.meters < far.meters, `${near.meters} should be under ${far.meters}`);
});

test('the estimate is independent of capture resolution', () => {
  // Distance falls out of the ratio and the lens alone, so a bigger sensor
  // changes nothing. Anyone expecting a higher resolution to extend the working
  // range is reading the geometry wrong.
  const hd = estimateDistance(boxOfRatio(0.2), FRAME_W)!;
  const uhd = estimateDistance(
    { x: 0, y: 0, width: 0.2 * 3840, height: 500 },
    3840
  )!;
  assert.ok(Math.abs(hd.meters - uhd.meters) < 0.01);
});

test('a known field of view collapses the band to a single figure', () => {
  const e = estimateDistance(boxOfRatio(0.2), FRAME_W, { fovDegrees: 65 })!;
  assert.equal(e.minMeters, e.maxMeters);
});

test('the quoted band matches hand-worked geometry', () => {
  // D = W / (2 * ratio * tan(F/2)); at ratio 0.2 and 60..70 degrees that is
  // 0.14 / (2 * 0.2 * tan(30deg)) = 0.606 m down to 0.500 m at 70 degrees.
  const e = estimateDistance(boxOfRatio(0.2), FRAME_W)!;
  assert.ok(Math.abs(e.maxMeters - 0.606) < 0.02, `max was ${e.maxMeters}`);
  assert.ok(Math.abs(e.minMeters - 0.5) < 0.02, `min was ${e.minMeters}`);
});

test('no detection yields no distance rather than a fabricated one', () => {
  assert.equal(estimateDistance({ x: 0, y: 0, width: 0, height: 0 }, FRAME_W), null);
  assert.equal(estimateDistance(boxOfRatio(0.2), 0), null);
});

test('ratio and distance invert each other', () => {
  const ratio = faceSizeRatioAtDistance(0.8);
  const back = estimateDistance(boxOfRatio(ratio), FRAME_W, { fovDegrees: 65 })!;
  assert.ok(Math.abs(back.meters - 0.8) < 0.03, `round-tripped to ${back.meters}`);
});

test('a face already large enough is not magnified', () => {
  assert.equal(zoomFactorToReach(0.35, 0.3), 1);
  assert.equal(zoomFactorToReach(0.3, 0.3), 1);
});

test('magnification is capped so a distant face is not blown up into mush', () => {
  assert.equal(zoomFactorToReach(0.05, 0.3, 3), 3);
  assert.ok(Math.abs(zoomFactorToReach(0.15, 0.3) - 2) < 1e-9);
});

test('the default face width is the landmark hull, not head breadth', () => {
  assert.equal(DEFAULT_FACE_WIDTH_M, 0.14);
});

test('the auto-zoom target corresponds to a sensible standing distance', () => {
  // The zoom loop aims for this share of the frame. Expressed as a distance it
  // has to be somewhere a person would naturally stand — a target picked in
  // ratio units alone can quietly mean "press your face to the lens".
  const TARGET_RATIO = 0.32;
  const at = estimateDistance(boxOfRatio(TARGET_RATIO), FRAME_W)!;
  assert.ok(at.meters > 0.25, `target implies ${at.meters} m, too close to stand`);
  assert.ok(at.meters < 0.6, `target implies ${at.meters} m, further than the framing needs`);
});

test('the distance a face becomes too small to use is roughly a metre away', () => {
  // MEDIUM rejects below ratio 0.10. Stating it in metres is what lets the
  // guidance tell someone how far back they have drifted.
  const floor = estimateDistance(boxOfRatio(0.1), FRAME_W)!;
  assert.ok(floor.maxMeters > 1.0, `floor sits at ${floor.maxMeters} m`);
  assert.ok(floor.minMeters < 1.3);
});
