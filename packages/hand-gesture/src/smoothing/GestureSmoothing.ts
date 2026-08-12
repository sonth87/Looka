import { GestureType, GestureState } from '@face/core';

export class GestureSmoothing {
  private history: { gesture: GestureType; confidence: number }[] = [];
  private windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  public reset(): void {
    this.history = [];
  }

  public smooth(rawState: GestureState): GestureState {
    this.history.push({ gesture: rawState.gesture, confidence: rawState.confidence });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    // Count occurrences of each gesture
    const counts = new Map<GestureType, { count: number; totalConf: number }>();
    for (const item of this.history) {
      const existing = counts.get(item.gesture) || { count: 0, totalConf: 0 };
      counts.set(item.gesture, {
        count: existing.count + 1,
        totalConf: existing.totalConf + item.confidence,
      });
    }

    let bestGesture: GestureType = 'NONE';
    let maxCount = 0;
    let bestAvgConf = 0;

    for (const [gesture, data] of counts.entries()) {
      const avgConf = data.totalConf / data.count;
      if (data.count > maxCount || (data.count === maxCount && avgConf > bestAvgConf)) {
        bestGesture = gesture;
        maxCount = data.count;
        bestAvgConf = avgConf;
      }
    }

    return {
      ...rawState,
      gesture: bestGesture,
      confidence: Number(bestAvgConf.toFixed(2)),
    };
  }
}
