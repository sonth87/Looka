import { CaptureTriggerConfig, CaptureTriggerMode, GestureState, GestureType } from '@face/core';

export interface CaptureDecision {
  capture: boolean;
  reason?: string;
  gestureProgress?: number; // 0..1 progress for MANUAL mode confirmation hold
  gestureState?: GestureState | null;
}

export class CaptureController {
  private config: CaptureTriggerConfig;
  private gestureStartTime: number | null = null;
  private currentGesture: GestureType = 'NONE';

  constructor(config?: Partial<CaptureTriggerConfig>) {
    this.config = {
      mode: 'AUTO',
      autoHoldMs: 2000,
      allowedGestures: ['VICTORY', 'THUMBS_UP', 'OPEN_PALM', 'CLOSED_FIST', 'OK_SIGN'],
      ...config,
    };
  }

  public updateConfig(newConfig: Partial<CaptureTriggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.mode) {
      this.reset();
    }
  }

  public getConfig(): CaptureTriggerConfig {
    return { ...this.config };
  }

  public reset(): void {
    this.gestureStartTime = null;
    this.currentGesture = 'NONE';
  }

  public evaluate(params: {
    faceReady: boolean;
    faceStabilityProgress: number; // 0..1
    gestureState?: GestureState | null;
    shutterButtonPressed?: boolean;
    currentTime?: number;
  }): CaptureDecision {
    const {
      faceReady,
      faceStabilityProgress,
      gestureState = null,
      shutterButtonPressed = false,
      currentTime = Date.now(),
    } = params;

    if (!faceReady) {
      this.reset();
      return { capture: false, gestureProgress: 0, gestureState };
    }

    const mode = this.config.mode;

    // Mode 1: AUTO (Hold pose for autoHoldMs)
    if (mode === 'AUTO') {
      const capture = faceStabilityProgress >= 1.0;
      return {
        capture,
        reason: capture ? 'AUTO_STABILITY_REACHED' : undefined,
        gestureState,
      };
    }

    // Mode 2: MANUAL (Hand gesture hold e.g. 500ms)
    if (mode === 'MANUAL') {
      const validGesture =
        gestureState &&
        gestureState.gesture !== 'NONE' &&
        gestureState.confidence >= 0.8 &&
        this.config.allowedGestures.includes(gestureState.gesture);

      if (!validGesture || !gestureState) {
        this.reset();
        return { capture: false, gestureProgress: 0, gestureState };
      }

      if (this.currentGesture !== gestureState.gesture || this.gestureStartTime === null) {
        this.currentGesture = gestureState.gesture;
        this.gestureStartTime = currentTime;
      }

      const holdDuration = 500; // 500ms confirmation hold
      const elapsedMs = currentTime - this.gestureStartTime;
      const gestureProgress = Math.min(1.0, elapsedMs / holdDuration);
      const capture = elapsedMs >= holdDuration;

      return {
        capture,
        reason: capture ? `MANUAL_GESTURE_${gestureState.gesture}` : undefined,
        gestureProgress: Number(gestureProgress.toFixed(2)),
        gestureState,
      };
    }

    // Mode 3: OFF (Manual shutter button click)
    if (mode === 'OFF') {
      return {
        capture: shutterButtonPressed,
        reason: shutterButtonPressed ? 'SHUTTER_BUTTON_CLICKED' : undefined,
        gestureState,
      };
    }

    return { capture: false, gestureState };
  }
}
