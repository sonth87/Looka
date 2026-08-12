import { StabilityTracker as IStabilityTracker } from '@face/core';

export class StabilityTracker implements IStabilityTracker {
  private startTime: number | null = null;

  public reset(): void {
    this.startTime = null;
  }

  public update(
    isConditionMet: boolean,
    requiredDurationMs: number,
    currentTime: number = Date.now()
  ): { isStable: boolean; elapsedMs: number; progress: number } {
    if (!isConditionMet || requiredDurationMs <= 0) {
      this.reset();
      return { isStable: false, elapsedMs: 0, progress: 0 };
    }

    if (this.startTime === null) {
      this.startTime = currentTime;
      return { isStable: false, elapsedMs: 0, progress: 0 };
    }

    const elapsedMs = currentTime - this.startTime;
    const progress = Math.min(1.0, elapsedMs / requiredDurationMs);
    const isStable = elapsedMs >= requiredDurationMs;

    return {
      isStable,
      elapsedMs,
      progress: Number(progress.toFixed(2)),
    };
  }
}
