import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureTriggerEvaluator } from '../CaptureTriggerEvaluator.js';

describe('CaptureTriggerEvaluator Tests', () => {
  it('AUTO mode should trigger capture when faceStabilityProgress >= 1.0', () => {
    const evaluator = new CaptureTriggerEvaluator({ mode: 'AUTO' });

    const d1 = evaluator.evaluate({ faceReady: true, faceStabilityProgress: 0.5 });
    assert.equal(d1.capture, false);

    const d2 = evaluator.evaluate({ faceReady: true, faceStabilityProgress: 1.0 });
    assert.equal(d2.capture, true);
    assert.equal(d2.reason, 'AUTO_STABILITY_REACHED');
  });

  it('MANUAL mode should require gesture match and 500ms confirmation hold', () => {
    const evaluator = new CaptureTriggerEvaluator({ mode: 'MANUAL', allowedGestures: ['VICTORY'] });

    const now = 10000;
    // No gesture → capture false
    const d1 = evaluator.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now, gesture: 'NONE', confidence: 0 },
      currentTime: now,
    });
    assert.equal(d1.capture, false);

    // VICTORY gesture starts → elapsed 0ms, progress 0
    const d2 = evaluator.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now, gesture: 'VICTORY', confidence: 0.9 },
      currentTime: now,
    });
    assert.equal(d2.capture, false);
    assert.equal(d2.gestureProgress, 0);

    // VICTORY gesture held for 500ms → capture true
    const d3 = evaluator.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now + 500, gesture: 'VICTORY', confidence: 0.9 },
      currentTime: now + 500,
    });
    assert.equal(d3.capture, true);
    assert.equal(d3.gestureProgress, 1.0);
  });

  it('OFF mode should trigger capture only when shutterButtonPressed is true', () => {
    const evaluator = new CaptureTriggerEvaluator({ mode: 'OFF' });

    const d1 = evaluator.evaluate({ faceReady: true, faceStabilityProgress: 0, shutterButtonPressed: false });
    assert.equal(d1.capture, false);

    const d2 = evaluator.evaluate({ faceReady: true, faceStabilityProgress: 0, shutterButtonPressed: true });
    assert.equal(d2.capture, true);
    assert.equal(d2.reason, 'SHUTTER_BUTTON_CLICKED');
  });

  it('Should reset gesture timer when face leaves readiness', () => {
    const evaluator = new CaptureTriggerEvaluator({ mode: 'MANUAL', allowedGestures: ['OPEN_PALM'] });
    const now = 20000;

    // Start OPEN_PALM gesture
    evaluator.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now, gesture: 'OPEN_PALM', confidence: 0.9 },
      currentTime: now,
    });

    // Face leaves readiness → evaluator resets
    const d = evaluator.evaluate({
      faceReady: false,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now + 300, gesture: 'OPEN_PALM', confidence: 0.9 },
      currentTime: now + 300,
    });
    assert.equal(d.capture, false);

    // Gesture restart should be at 0 progress
    const d2 = evaluator.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now + 400, gesture: 'OPEN_PALM', confidence: 0.9 },
      currentTime: now + 400,
    });
    assert.equal(d2.gestureProgress, 0);
  });
});
