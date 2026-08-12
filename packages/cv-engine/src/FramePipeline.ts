import { CVEngine, FaceState, FrameInput } from '@face/core';

export interface FramePipelineOptions {
  maxFps?: number;
}

export class FramePipeline {
  private engine: CVEngine;
  private isBusy = false;
  private pendingFrame: FrameInput | null = null;
  private droppedFrameCount = 0;
  private processedFrameCount = 0;
  private frameTimes: number[] = [];
  private currentCvFps = 0;
  private onResultCallback?: (faceState: FaceState, cvFps: number) => void;
  private onErrorCallback?: (error: any) => void;

  constructor(engine: CVEngine, _options: FramePipelineOptions = {}) {
    this.engine = engine;
  }

  public get droppedFrames(): number {
    return this.droppedFrameCount;
  }

  public get processedFrames(): number {
    return this.processedFrameCount;
  }

  public get cvFps(): number {
    return this.currentCvFps;
  }

  public onResult(callback: (faceState: FaceState, cvFps: number) => void): void {
    this.onResultCallback = callback;
  }

  public onError(callback: (error: any) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Pushes a new frame into the pipeline.
   * If the pipeline is currently busy, the frame is stored as the latest pending frame (overwriting any previous pending frame).
   */
  public pushFrame(frame: FrameInput): void {
    if (!this.engine.isInitialized) return;

    if (this.isBusy) {
      if (this.pendingFrame) {
        this.droppedFrameCount++;
      }
      this.pendingFrame = frame;
      return;
    }

    this.processFrame(frame);
  }

  public resetStats(): void {
    this.droppedFrameCount = 0;
    this.processedFrameCount = 0;
    this.frameTimes = [];
    this.currentCvFps = 0;
    this.pendingFrame = null;
    this.isBusy = false;
  }

  private async processFrame(frame: FrameInput): Promise<void> {
    this.isBusy = true;
    const startTime = performance.now();

    try {
      const faceState = await this.engine.processFrame(frame);
      const endTime = performance.now();

      this.processedFrameCount++;
      this.updateFps(endTime - startTime);

      if (this.onResultCallback) {
        this.onResultCallback(faceState, this.currentCvFps);
      }
    } catch (err: any) {
      if (this.onErrorCallback) {
        this.onErrorCallback(err);
      }
    } finally {
      this.isBusy = false;

      // Immediately process latest pending frame if available
      if (this.pendingFrame) {
        const nextFrame = this.pendingFrame;
        this.pendingFrame = null;
        this.processFrame(nextFrame);
      }
    }
  }

  private updateFps(frameDurationMs: number): void {
    this.frameTimes.push(frameDurationMs);
    if (this.frameTimes.length > 30) {
      this.frameTimes.shift();
    }

    const avgDuration =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.currentCvFps =
      avgDuration > 0 ? Math.round(1000 / avgDuration) : 0;
  }
}
