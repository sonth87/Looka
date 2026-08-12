import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FramePipeline } from '../FramePipeline.js';
import { MockCVEngine } from '../MockCVEngine.js';
import { FaceState } from '@face/core';

describe('FramePipeline', () => {
  test('should process frames and invoke result callback', async () => {
    const mockEngine = new MockCVEngine({ simulatedDelayMs: 10 });
    await mockEngine.initialize();

    const pipeline = new FramePipeline(mockEngine);
    let resultCount = 0;
    let lastState: FaceState | null = null;

    pipeline.onResult((state) => {
      resultCount++;
      lastState = state;
    });

    const frame = {
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: Date.now(),
    };

    pipeline.pushFrame(frame);

    // Wait for async processing to finish
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(resultCount, 1);
    assert.ok(lastState !== null);
    assert.equal(pipeline.processedFrames, 1);
    assert.equal(pipeline.droppedFrames, 0);
  });

  test('should drop intermediate frames when busy (latest-frame-wins)', async () => {
    const slowEngine = new MockCVEngine({ simulatedDelayMs: 100 });
    await slowEngine.initialize();

    const pipeline = new FramePipeline(slowEngine);

    const frame = (ts: number) => ({
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
      timestamp: ts,
    });

    // Frame 1 starts processing (busy for 100ms)
    pipeline.pushFrame(frame(100));

    // Push Frame 2 while busy -> pendingFrame = Frame 2
    pipeline.pushFrame(frame(200));

    // Push Frame 3 while busy -> pendingFrame = Frame 3 (Frame 2 dropped!)
    pipeline.pushFrame(frame(300));

    // Wait for Frame 1 + Frame 3 processing to complete (~250ms)
    await new Promise((r) => setTimeout(r, 260));

    assert.equal(pipeline.processedFrames, 2); // Frame 1 and Frame 3
    assert.equal(pipeline.droppedFrames, 1); // Frame 2 was dropped
  });
});
