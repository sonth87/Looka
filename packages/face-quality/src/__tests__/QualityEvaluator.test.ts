import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QualityEvaluator } from '../QualityEvaluator.js';

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

  test('should reject face that is too small', () => {
    const result = evaluator.evaluateQuality(
      { x: 280, y: 200, width: 80, height: 80 }, // size ratio 80/640 = 0.125 < min 0.20
      640,
      480
    );

    assert.equal(result.accepted, false);
    assert.ok(result.reasons.includes('FACE_TOO_SMALL'));
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
});
