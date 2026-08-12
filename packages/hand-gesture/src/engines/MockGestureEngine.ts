import { FrameInput, GestureEngine, GestureState, GestureType } from '@face/core';

export interface MockGestureSettings {
  gesture?: GestureType;
  confidence?: number;
  simulatedDelayMs?: number;
}

export class MockGestureEngine implements GestureEngine {
  public readonly name = 'MockGestureEngine';
  private _initialized = false;
  private settings: MockGestureSettings;

  constructor(initialSettings: MockGestureSettings = {}) {
    this.settings = {
      gesture: 'NONE',
      confidence: 0.95,
      simulatedDelayMs: 0,
      ...initialSettings,
    };
  }

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public async initialize(): Promise<void> {
    if (this.settings.simulatedDelayMs && this.settings.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settings.simulatedDelayMs));
    }
    this._initialized = true;
  }

  public updateSettings(newSettings: Partial<MockGestureSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  public async processFrame(frame: FrameInput): Promise<GestureState> {
    if (!this._initialized) {
      throw new Error('MockGestureEngine is not initialized.');
    }

    if (this.settings.simulatedDelayMs && this.settings.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settings.simulatedDelayMs));
    }

    const gesture = this.settings.gesture ?? 'NONE';
    const confidence = gesture === 'NONE' ? 0 : (this.settings.confidence ?? 0.95);

    return {
      timestamp: frame.timestamp,
      gesture,
      confidence,
    };
  }

  public async dispose(): Promise<void> {
    this._initialized = false;
  }
}
