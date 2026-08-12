import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedClassifier } from '../classifiers/RuleBasedClassifier.js';
import { GestureSmoothing } from '../smoothing/GestureSmoothing.js';
import { MockGestureEngine } from '../engines/MockGestureEngine.js';
import { HandLandmark } from '@face/core';

describe('Hand Gesture Package Tests', () => {
  it('RuleBasedClassifier should classify NONE when landmarks are missing or insufficient', () => {
    const classifier = new RuleBasedClassifier();
    const result = classifier.classify([]);
    assert.equal(result.gesture, 'NONE');
  });

  it('RuleBasedClassifier should classify OPEN_PALM when all 5 fingers are extended', () => {
    const classifier = new RuleBasedClassifier();
    const wrist: HandLandmark = { x: 0.5, y: 0.9, z: 0 };
    // Create 21 landmarks where finger tips (4, 8, 12, 16, 20) are far from wrist (y=0.1) and MCP (y=0.6)
    const landmarks: HandLandmark[] = Array.from({ length: 21 }, (_, i) => {
      if (i === 0) return wrist;
      if ([4, 8, 12, 16, 20].includes(i)) {
        return { x: 0.2 + i * 0.03, y: 0.1, z: 0 };
      }
      return { x: 0.2 + i * 0.03, y: 0.6, z: 0 };
    });
    const result = classifier.classify(landmarks);
    assert.equal(result.gesture, 'OPEN_PALM');
  });

  it('MockGestureEngine should process frame and return configured gesture', async () => {
    const mock = new MockGestureEngine({ gesture: 'VICTORY', confidence: 0.95 });
    await mock.initialize();
    assert.equal(mock.isInitialized, true);

    const state = await mock.processFrame({
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: 1000,
    });

    assert.equal(state.gesture, 'VICTORY');
    assert.equal(state.confidence, 0.95);
  });

  it('GestureSmoothing should average confidence and smooth gesture majority', () => {
    const smoothing = new GestureSmoothing(3);
    const s1 = smoothing.smooth({ timestamp: 1, gesture: 'VICTORY', confidence: 0.9 });
    const s2 = smoothing.smooth({ timestamp: 2, gesture: 'VICTORY', confidence: 0.8 });
    const s3 = smoothing.smooth({ timestamp: 3, gesture: 'THUMBS_UP', confidence: 0.7 });

    assert.equal(s3.gesture, 'VICTORY');
  });
});
