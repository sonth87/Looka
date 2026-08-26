import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePosture } from '../BodyPostureEvaluator.js';

/**
 * Landmarks are built in IMAGE space (x rises towards the right of the
 * image), same convention as PoseEstimator.test.ts. MediaPipe's Pose model
 * numbers landmark 11 as the subject's own (anatomical) LEFT shoulder and 12
 * as their RIGHT shoulder — facing an unmirrored camera, that means landmark
 * 11 sits at the LARGER x (image-right) and landmark 12 at the SMALLER x
 * (image-left). Getting this backwards is exactly the regression this file
 * pins down: a level pair of shoulders built with 11 on the image-right and
 * 12 on the image-left must read as ~0 degrees, not ~180.
 */
const ASPECT = 16 / 9;

const landmarksWithShoulders = (
  left: { x: number; y: number; visibility?: number },
  right: { x: number; y: number; visibility?: number }
) => {
  const landmarks = new Array(13).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[11] = { x: left.x, y: left.y, z: 0, visibility: left.visibility ?? 1 };
  landmarks[12] = { x: right.x, y: right.y, z: 0, visibility: right.visibility ?? 1 };
  return landmarks;
};

describe('evaluatePosture', () => {
  test('level shoulders, square to the camera, read as near-zero roll', () => {
    // Landmark 11 (subject's left) at image-right, landmark 12 (subject's
    // right) at image-left, same height — a person sitting up straight.
    const landmarks = landmarksWithShoulders({ x: 0.65, y: 0.5 }, { x: 0.35, y: 0.5 });
    const result = evaluatePosture(landmarks, ASPECT);

    assert.equal(result.shouldersVisible, true);
    assert.ok(result.shoulderRoll !== null && Math.abs(result.shoulderRoll) < 5, `expected near-0 roll, got ${result.shoulderRoll}`);
    assert.equal(result.leveled, true);
    assert.deepEqual(result.reasons, []);
  });

  test('a genuinely tilted pair of shoulders is flagged', () => {
    // Subject's left shoulder raised well above their right — a real lean.
    const landmarks = landmarksWithShoulders({ x: 0.65, y: 0.3 }, { x: 0.35, y: 0.5 });
    const result = evaluatePosture(landmarks, ASPECT);

    assert.equal(result.leveled, false);
    assert.ok(result.reasons.includes('SHOULDERS_TILTED'));
  });

  test('low-visibility shoulders are reported as not visible, not as tilted', () => {
    const landmarks = landmarksWithShoulders(
      { x: 0.65, y: 0.5, visibility: 0.1 },
      { x: 0.35, y: 0.5, visibility: 0.1 }
    );
    const result = evaluatePosture(landmarks, ASPECT);

    assert.equal(result.shouldersVisible, false);
    assert.deepEqual(result.reasons, ['SHOULDERS_NOT_VISIBLE']);
  });

  test('missing landmarks produce nulls rather than a crash', () => {
    const result = evaluatePosture(null, ASPECT);
    assert.deepEqual(result, { shoulderRoll: null, shouldersVisible: null, leveled: null, reasons: [] });
  });
});
