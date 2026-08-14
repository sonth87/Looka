import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityEvaluator, SENSITIVITY_PRESETS } from '../QualityEvaluator.js';

/**
 * Pins the gap between an in-focus face and a blurred one.
 *
 * Sharpness is measured on the face, and a face is mostly smooth skin, so the
 * numbers are an order of magnitude below what the whole frame used to produce
 * in a furnished room. Thresholds carried over from those inflated readings sat
 * above anything a real face could reach, and every capture was rejected as
 * blurry no matter how still the subject held.
 */

const W = 640;
const H = 480;
const FACE = { x: 220, y: 120, width: 200, height: 240 };
const evaluator = new QualityEvaluator();

/** A face with the features that actually carry detail: brows, lips, nostrils. */
function faceFrame(blurPasses: number): Uint8ClampedArray {
  let cur = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 150 + 8 * Math.sin(x / 40) + 8 * Math.sin(y / 40);
      const fy = (y - FACE.y) / FACE.height;
      const fx = (x - FACE.x) / FACE.width;
      if (fx > 0 && fx < 1 && fy > 0 && fy < 1) {
        if (Math.abs(fy - 0.32) < 0.02 && fx > 0.15 && fx < 0.85) v -= 55;
        if (Math.abs(fy - 0.72) < 0.025 && fx > 0.25 && fx < 0.75) v -= 45;
        if (Math.abs(fy - 0.55) < 0.015 && Math.abs(fx - 0.5) < 0.06) v -= 35;
      }
      cur[y * W + x] = v;
    }
  }

  for (let p = 0; p < blurPasses; p++) {
    const next = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += cur[(y + dy) * W + (x + dx)];
        }
        next[y * W + x] = sum / 9;
      }
    }
    cur = next;
  }

  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = cur[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

const sharpnessAt = (blur: number) =>
  evaluator.calculateSharpness(faceFrame(blur), W, H, FACE);

test('blurring a face drops it below the MEDIUM gate', () => {
  const sharp = sharpnessAt(0);
  const blurred = sharpnessAt(8);
  assert.ok(blurred < sharp, `blur did not reduce sharpness: ${sharp} -> ${blurred}`);
  assert.ok(
    blurred < SENSITIVITY_PRESETS.MEDIUM.minSharpness,
    `blurred face read ${blurred}, which MEDIUM must reject`
  );
});

test('sharpness falls monotonically as blur increases', () => {
  const readings = [0, 2, 4, 8].map(sharpnessAt);
  for (let i = 1; i < readings.length; i++) {
    assert.ok(
      readings[i] <= readings[i - 1],
      `blur increased but sharpness rose: ${readings.join(', ')}`
    );
  }
});

/**
 * Anchors taken from real captures, not from the synthetic face above.
 *
 * Generated skin carries none of the pores, lashes or stray hair that give a
 * real face its detail, so the synthetic curve shows how sharpness falls with
 * blur but reads systematically low. Where the line belongs is set by these.
 */
const FIELD_SHARP_FACE = 0.2;
const FIELD_BLURRED_FACE = 0.097;

test('every threshold sits between a blurred face and an in-focus one', () => {
  // A threshold above an in-focus face rejects everything; one below a blurred
  // face accepts everything. Both are silent failures — the gate looks present
  // but decides nothing, and the first is what made every capture in the field
  // report "blurry" no matter how still the subject held.
  // VERY_LOW and LOW are advertised in the settings panel as deliberately
  // permissive — "mờ/tối vẫn pass" — so letting a soft frame through is their
  // purpose, not a miscalibration. Everything from MEDIUM up must catch it.
  const MUST_REJECT_BLUR = ['MEDIUM', 'HIGH', 'VERY_HIGH'];

  for (const [level, preset] of Object.entries(SENSITIVITY_PRESETS)) {
    assert.ok(
      preset.minSharpness < FIELD_SHARP_FACE,
      `${level} floor ${preset.minSharpness} would reject an in-focus face at ${FIELD_SHARP_FACE}`
    );
    if (MUST_REJECT_BLUR.includes(level)) {
      assert.ok(
        preset.minSharpness > FIELD_BLURRED_FACE,
        `${level} floor ${preset.minSharpness} would accept a blurred face at ${FIELD_BLURRED_FACE}`
      );
    }
  }
});

test('the permissive tiers stay ordered below the strict ones', () => {
  const order = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      SENSITIVITY_PRESETS[order[i]].minSharpness > SENSITIVITY_PRESETS[order[i - 1]].minSharpness,
      `${order[i]} is not stricter than ${order[i - 1]}`
    );
  }
});

test('the field reading of a real in-focus face is accepted at MEDIUM', () => {
  // Measured on the deployed kiosk: a face in focus in an office read 0.20 and
  // was rejected as blurry by the pre-calibration threshold of 0.35.
  assert.ok(FIELD_SHARP_FACE > SENSITIVITY_PRESETS.MEDIUM.minSharpness);
  assert.ok(FIELD_SHARP_FACE > SENSITIVITY_PRESETS.HIGH.minSharpness);
});
