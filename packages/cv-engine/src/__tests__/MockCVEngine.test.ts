import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockCVEngine } from '../MockCVEngine.js';

describe('MockCVEngine', () => {
  test('should initialize and process frame with mock face state', async () => {
    const engine = new MockCVEngine({
      detected: true,
      faceCount: 1,
      pose: { yaw: -15, pitch: 0, roll: 0 },
      simulatedDelayMs: 0,
    });

    assert.equal(engine.isInitialized, false);
    await engine.initialize();
    assert.equal(engine.isInitialized, true);

    const frame = {
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: 1000,
    };

    const faceState = await engine.processFrame(frame);

    assert.equal(faceState.detected, true);
    assert.equal(faceState.faceCount, 1);
    assert.equal(faceState.presence, 'SINGLE_FACE');
    assert.equal(faceState.pose?.yaw, -15);
    assert.equal(faceState.quality?.accepted, true);

    await engine.dispose();
    assert.equal(engine.isInitialized, false);
  });

  test('should return NO_FACE when detected is false', async () => {
    const engine = new MockCVEngine({
      detected: false,
      simulatedDelayMs: 0,
    });

    await engine.initialize();

    const frame = {
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: 1001,
    };

    const faceState = await engine.processFrame(frame);

    assert.equal(faceState.detected, false);
    assert.equal(faceState.faceCount, 0);
    assert.equal(faceState.presence, 'NO_FACE');

    await engine.dispose();
  });
});
