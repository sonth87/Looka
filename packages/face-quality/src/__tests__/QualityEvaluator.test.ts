import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BoundingBox, CaptureSensitivity } from '@face/core';
import { QualityEvaluator, SENSITIVITY_PRESETS } from '../QualityEvaluator.js';

/** The resolution BrowserCameraService asks the camera for. */
const FRAME_W = 1280;
const FRAME_H = 720;

/** Centred box of a given width, so size gates are tested clear of OFF_CENTER. */
const boxOfRatio = (ratio: number, frameW = FRAME_W, frameH = FRAME_H): BoundingBox => {
  const width = Math.round(ratio * frameW);
  const height = Math.round(width * 1.3);
  return {
    x: Math.round((frameW - width) / 2),
    y: Math.round((frameH - height) / 2),
    width,
    height,
  };
};

/**
 * Deterministic low-amplitude noise stands in for facial detail, and a constant
 * fill for a featureless surface. A periodic pattern would alias against the
 * Laplacian's stride-2 sampling and read as perfectly flat.
 */
const makeFrame = (
  width: number,
  height: number,
  background: 'flat' | 'detailed',
  region: BoundingBox,
  inside: 'flat' | 'detailed'
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 20240517;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 24 - 12;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inRegion =
        x >= region.x &&
        x < region.x + region.width &&
        y >= region.y &&
        y < region.y + region.height;
      const mode = inRegion ? inside : background;
      const value = mode === 'detailed' ? 128 + noise() : 128;
      const p = (y * width + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return data;
};

const ALL_LEVELS: CaptureSensitivity[] = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

describe('QualityEvaluator', () => {
  const evaluator = new QualityEvaluator();

  test('should calculate brightness correctly', () => {
    // 2x2 image, all black
    const blackPixels = new Uint8ClampedArray(2 * 2 * 4).fill(0);
    for (let i = 3; i < blackPixels.length; i += 4) blackPixels[i] = 255;
    assert.equal(evaluator.calculateBrightness(blackPixels), 0);

    // 2x2 image, all white
    const whitePixels = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    assert.ok(Math.abs(evaluator.calculateBrightness(whitePixels) - 1.0) < 0.001);
  });

  test('should accept face with valid size, position, and quality', () => {
    const result = evaluator.evaluateQuality(
      { x: 160, y: 120, width: 320, height: 240 },
      640,
      480
    );

    assert.equal(result.accepted, true);
    assert.equal(result.reasons.length, 0);
    assert.equal(result.faceSizeRatio, 0.5);
  });

  test('should reject face that is off center', () => {
    const result = evaluator.evaluateQuality(
      { x: 10, y: 10, width: 250, height: 250 }, // way to the top left
      640,
      480
    );

    assert.equal(result.accepted, false);
    assert.ok(result.reasons.includes('OFF_CENTER'));
  });

  describe('accepted distance range per sensitivity', () => {
    // Distance floors, as bounding-box width over frame width. At 1280 px wide
    // and a 60-70 degree webcam these are roughly 1.25-1.52 m (0.08),
    // 1.11-1.35 m (0.09), 1.00-1.21 m (0.10), 0.40-0.48 m (0.25) and
    // 0.33-0.40 m (0.30).
    const EXPECTED_FLOORS: Record<CaptureSensitivity, number> = {
      VERY_LOW: 0.08,
      LOW: 0.09,
      MEDIUM: 0.10,
      HIGH: 0.25,
      VERY_HIGH: 0.30,
    };

    const EXPECTED_CEILINGS: Record<CaptureSensitivity, number> = {
      VERY_LOW: 0.55,
      LOW: 0.50,
      MEDIUM: 0.55,
      HIGH: 0.40,
      VERY_HIGH: 0.38,
    };

    for (const level of ALL_LEVELS) {
      test(`${level} pins its band to [${EXPECTED_FLOORS[level]}, ${EXPECTED_CEILINGS[level]}]`, () => {
        assert.equal(SENSITIVITY_PRESETS[level].minFaceSizeRatio, EXPECTED_FLOORS[level]);
        assert.equal(SENSITIVITY_PRESETS[level].maxFaceSizeRatio, EXPECTED_CEILINGS[level]);
      });

      test(`${level} accepts a face just inside its floor and rejects one just outside`, () => {
        const floor = EXPECTED_FLOORS[level];

        const inside = evaluator.evaluateQuality(
          boxOfRatio(floor + 0.005),
          FRAME_W,
          FRAME_H,
          undefined,
          { sensitivity: level }
        );
        assert.equal(inside.accepted, true, `${level} should accept just above its floor`);

        const outside = evaluator.evaluateQuality(
          boxOfRatio(floor - 0.005),
          FRAME_W,
          FRAME_H,
          undefined,
          { sensitivity: level }
        );
        assert.ok(
          outside.reasons.includes('FACE_TOO_SMALL'),
          `${level} should still reject below its floor`
        );
      });

      test(`${level} still rejects a face past its ceiling`, () => {
        const result = evaluator.evaluateQuality(
          boxOfRatio(EXPECTED_CEILINGS[level] + 0.02),
          FRAME_W,
          FRAME_H,
          undefined,
          { sensitivity: level }
        );
        assert.ok(result.reasons.includes('FACE_TOO_LARGE'));
      });
    }

    test('the floor is not removed — a face with too few pixels is still rejected everywhere', () => {
      // 0.06 * 1280 = 77 px of hull, which cannot fill the 112 px recogniser
      // crop without upscaling.
      for (const level of ALL_LEVELS) {
        const result = evaluator.evaluateQuality(boxOfRatio(0.06), FRAME_W, FRAME_H, undefined, {
          sensitivity: level,
        });
        assert.ok(
          result.reasons.includes('FACE_TOO_SMALL'),
          `${level} must reject a 77 px face`
        );
      }
    });
  });

  describe('far-distance regression', () => {
    test('a face at roughly half the old floor is accepted by the permissive levels', () => {
      // Around a metre out on a 1280 px frame — the distance at which the
      // operator was being told to come closer.
      const cases: [CaptureSensitivity, number][] = [
        ['VERY_LOW', 0.085],
        ['LOW', 0.095],
        ['MEDIUM', 0.11],
      ];

      for (const [level, ratio] of cases) {
        const result = evaluator.evaluateQuality(
          boxOfRatio(ratio),
          FRAME_W,
          FRAME_H,
          undefined,
          { sensitivity: level }
        );
        assert.equal(
          result.accepted,
          true,
          `${level} should accept ratio ${ratio}, got ${result.reasons.join(',')}`
        );
      }
    });

    test('the field reading of 0.23-0.26 is rejected only by the eKYC levels', () => {
      for (let ratio = 0.23; ratio <= 0.2601; ratio += 0.01) {
        const rounded = Number(ratio.toFixed(2));
        const box = boxOfRatio(rounded);

        for (const level of ['VERY_LOW', 'LOW', 'MEDIUM'] as CaptureSensitivity[]) {
          const result = evaluator.evaluateQuality(box, FRAME_W, FRAME_H, undefined, {
            sensitivity: level,
          });
          assert.equal(
            result.accepted,
            true,
            `${level} should accept the field reading ${rounded}`
          );
        }

        // HIGH's floor of 0.25 straddles this range; VERY_HIGH's 0.30 excludes all of it.
        const high = evaluator.evaluateQuality(box, FRAME_W, FRAME_H, undefined, {
          sensitivity: 'HIGH',
        });
        assert.equal(high.reasons.includes('FACE_TOO_SMALL'), rounded < 0.25);

        const veryHigh = evaluator.evaluateQuality(box, FRAME_W, FRAME_H, undefined, {
          sensitivity: 'VERY_HIGH',
        });
        assert.ok(
          veryHigh.reasons.includes('FACE_TOO_SMALL'),
          `VERY_HIGH should reject ${rounded}`
        );
      }
    });

    test('an accepted distant face is not scored as though it were nearly invalid', () => {
      const distant = evaluator.evaluateQuality(boxOfRatio(0.12), FRAME_W, FRAME_H, undefined, {
        sensitivity: 'MEDIUM',
      });

      assert.equal(distant.accepted, true);
      // Feeds the embedding weighting, so an accepted capture must not be
      // discounted to near nothing purely for being far away.
      assert.ok(distant.overallScore > 0.6, `score was ${distant.overallScore}`);
    });
  });

  describe('sharpness is measured on the face, not the room', () => {
    const farFace = boxOfRatio(0.12);

    test('a sharp distant face on a plain wall is not called blurry', () => {
      const pixels = makeFrame(FRAME_W, FRAME_H, 'flat', farFace, 'detailed');

      const wholeFrame = evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H);
      const faceRegion = evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H, farFace);

      // Stated against the face-region reading rather than a threshold: the
      // point is that the two measurements disagree about the same picture, and
      // that claim must survive any recalibration of where the line sits.
      assert.ok(
        wholeFrame < faceRegion,
        `whole-frame ${wholeFrame} should read lower than the face itself at ${faceRegion}`
      );
      assert.ok(
        faceRegion > SENSITIVITY_PRESETS.MEDIUM.minSharpness,
        `face region ${faceRegion} should clear MEDIUM's gate`
      );

      const result = evaluator.evaluateQuality(farFace, FRAME_W, FRAME_H, pixels, {
        sensitivity: 'MEDIUM',
      });
      assert.ok(!result.reasons.includes('BLURRY'), result.reasons.join(','));
    });

    test('a blurred face against a detailed background is not called sharp', () => {
      const pixels = makeFrame(FRAME_W, FRAME_H, 'detailed', farFace, 'flat');

      const wholeFrame = evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H);
      const faceRegion = evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H, farFace);

      assert.ok(
        wholeFrame > SENSITIVITY_PRESETS.MEDIUM.minSharpness,
        `whole-frame ${wholeFrame} should be misled by the background`
      );
      assert.ok(
        faceRegion < wholeFrame,
        `face region ${faceRegion} should read lower than the busy room at ${wholeFrame}`
      );
      assert.ok(
        faceRegion < SENSITIVITY_PRESETS.MEDIUM.minSharpness,
        `a blurred face read ${faceRegion}, which MEDIUM's gate of ` +
          `${SENSITIVITY_PRESETS.MEDIUM.minSharpness} must reject`
      );

      const result = evaluator.evaluateQuality(farFace, FRAME_W, FRAME_H, pixels, {
        sensitivity: 'MEDIUM',
      });
      assert.ok(result.reasons.includes('BLURRY'));
    });

    test('a region too small to estimate from falls back to the whole frame', () => {
      const tiny = { x: 640, y: 360, width: 4, height: 4 };
      const pixels = makeFrame(FRAME_W, FRAME_H, 'detailed', tiny, 'flat');

      assert.equal(
        evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H, tiny),
        evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H)
      );
    });

    test('a region overlapping the frame edge stays inside the buffer', () => {
      const overhang = { x: -40, y: -30, width: 400, height: 400 };
      const pixels = makeFrame(FRAME_W, FRAME_H, 'detailed', overhang, 'detailed');

      const value = evaluator.calculateSharpness(pixels, FRAME_W, FRAME_H, overhang);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `got ${value}`);
    });
  });
});
