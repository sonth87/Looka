import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureController } from '../CaptureController.js';

describe('CaptureController Tests', () => {
  it('AUTO mode should trigger capture when faceStabilityProgress >= 1.0', () => {
    const controller = new CaptureController({ mode: 'AUTO' });

    const d1 = controller.evaluate({ faceReady: true, faceStabilityProgress: 0.5 });
    assert.equal(d1.capture, false);

    const d2 = controller.evaluate({ faceReady: true, faceStabilityProgress: 1.0 });
    assert.equal(d2.capture, true);
    assert.equal(d2.reason, 'AUTO_STABILITY_REACHED');
  });

  it('MANUAL mode should require gesture match and 500ms confirmation hold', () => {
    const controller = new CaptureController({ mode: 'MANUAL', allowedGestures: ['VICTORY'] });

    const now = 10000;
    // Step 1: No gesture -> capture false
    const d1 = controller.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now, gesture: 'NONE', confidence: 0 },
      currentTime: now,
    });
    assert.equal(d1.capture, false);

    // Step 2: VICTORY gesture starts -> elapsed 0ms, progress 0
    const d2 = controller.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now, gesture: 'VICTORY', confidence: 0.9 },
      currentTime: now,
    });
    assert.equal(d2.capture, false);
    assert.equal(d2.gestureProgress, 0);

    // Step 3: VICTORY gesture held for 500ms -> capture true
    const d3 = controller.evaluate({
      faceReady: true,
      faceStabilityProgress: 0,
      gestureState: { timestamp: now + 500, gesture: 'VICTORY', confidence: 0.9 },
      currentTime: now + 500,
    });
    assert.equal(d3.capture, true);
    assert.equal(d3.gestureProgress, 1.0);
  });

  it('OFF mode should trigger capture only when shutterButtonPressed is true', () => {
    const controller = new CaptureController({ mode: 'OFF' });

    const d1 = controller.evaluate({ faceReady: true, faceStabilityProgress: 0, shutterButtonPressed: false });
    assert.equal(d1.capture, false);

    const d2 = controller.evaluate({ faceReady: true, faceStabilityProgress: 0, shutterButtonPressed: true });
    assert.equal(d2.capture, true);
    assert.equal(d2.reason, 'SHUTTER_BUTTON_CLICKED');
  });
});
