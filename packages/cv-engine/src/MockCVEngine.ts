import {
  AlignedFace,
  CVEngine,
  FacePose,
  FaceQualityResult,
  FaceState,
  FrameInput,
} from '@face/core';

export interface MockCVSettings {
  detected?: boolean;
  faceCount?: number;
  pose?: FacePose;
  quality?: Partial<FaceQualityResult>;
  confidence?: number;
  simulatedDelayMs?: number;
}

export class MockCVEngine implements CVEngine {
  public readonly name = 'MockCVEngine';
  private _initialized = false;
  private settings: MockCVSettings;

  constructor(initialSettings: MockCVSettings = {}) {
    this.settings = {
      detected: true,
      faceCount: 1,
      pose: { yaw: 0, pitch: 0, roll: 0 },
      confidence: 0.98,
      simulatedDelayMs: 10,
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

  public updateSettings(newSettings: Partial<MockCVSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  public async processFrame(frame: FrameInput): Promise<FaceState> {
    if (!this._initialized) {
      throw new Error('MockCVEngine is not initialized.');
    }

    if (this.settings.simulatedDelayMs && this.settings.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settings.simulatedDelayMs));
    }

    const detected = this.settings.detected ?? true;
    const faceCount = detected ? (this.settings.faceCount ?? 1) : 0;
    const presence =
      faceCount === 0 ? 'NO_FACE' : faceCount === 1 ? 'SINGLE_FACE' : 'MULTIPLE_FACES';

    if (!detected || faceCount === 0) {
      return {
        timestamp: frame.timestamp,
        detected: false,
        faceCount: 0,
        presence: 'NO_FACE',
      };
    }

    const defaultPose: FacePose = { yaw: 0, pitch: 0, roll: 0 };
    const pose = this.settings.pose ? { ...defaultPose, ...this.settings.pose } : defaultPose;

    const defaultQuality: FaceQualityResult = {
      overallScore: 0.9,
      accepted: true,
      sharpness: 0.88,
      brightness: 0.75,
      faceSizeRatio: 0.45,
      centerXOffset: 0.02,
      centerYOffset: 0.01,
      eyesVisible: true,
      mouthVisible: true,
      occluded: false,
      reasons: [],
    };

    const quality = { ...defaultQuality, ...this.settings.quality };

    const primaryBox = {
      x: Math.round(frame.width * 0.25),
      y: Math.round(frame.height * 0.15),
      width: Math.round(frame.width * 0.5),
      height: Math.round(frame.height * 0.7),
    };

    const allDetections = Array.from({ length: faceCount }, (_, idx) => {
      if (idx === 0) {
        return { boundingBox: primaryBox, confidence: this.settings.confidence ?? 0.98 };
      }
      // Offset secondary simulated faces
      const offsetFactor = idx * 0.18;
      return {
        boundingBox: {
          x: Math.round(frame.width * (0.05 + offsetFactor)),
          y: Math.round(frame.height * 0.25),
          width: Math.round(frame.width * 0.28),
          height: Math.round(frame.height * 0.45),
        },
        confidence: 0.92,
      };
    });

    return {
      timestamp: frame.timestamp,
      detected: true,
      faceCount,
      presence,
      detection: allDetections[0],
      center: {
        x: Math.round(frame.width * 0.5),
        y: Math.round(frame.height * 0.5),
      },
      pose,
      quality,
      confidence: this.settings.confidence ?? 0.98,
      allDetections,
    };
  }

  public async align(frame: FrameInput, faceState: FaceState): Promise<AlignedFace> {
    if (!faceState.detected || !faceState.detection) {
      throw new Error('Cannot align frame without detected face.');
    }

    return {
      data: frame.data,
      width: faceState.detection.boundingBox.width,
      height: faceState.detection.boundingBox.height,
      landmarks: [],
      cropBox: faceState.detection.boundingBox,
    };
  }

  public async dispose(): Promise<void> {
    this._initialized = false;
  }
}
