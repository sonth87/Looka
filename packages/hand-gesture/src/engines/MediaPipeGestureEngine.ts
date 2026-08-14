import { FrameInput, GestureEngine, GestureState, HandLandmark } from '@face/core';
import { RuleBasedClassifier } from '../classifiers/RuleBasedClassifier.js';
import { GestureSmoothing } from '../smoothing/GestureSmoothing.js';

export interface MediaPipeGestureEngineOptions {
  /** Folder holding the MediaPipe wasm runtime. Local by default. */
  wasmPath?: string;
  /** Hand landmarker model file. Local by default. */
  modelPath?: string;
}

export class MediaPipeGestureEngine implements GestureEngine {
  public readonly name = 'MediaPipeGestureEngine';
  private _initialized = false;
  private handLandmarker: any = null;
  private classifier = new RuleBasedClassifier();
  private smoothing = new GestureSmoothing(5);
  private readonly wasmPath: string;
  private readonly modelPath: string;

  constructor(options: MediaPipeGestureEngineOptions = {}) {
    this.wasmPath = options.wasmPath ?? './wasm';
    this.modelPath = options.modelPath ?? './models/hand_landmarker.task';
  }

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      if (typeof window !== 'undefined') {
        const tasksVision = await import('@mediapipe/tasks-vision');
        const { HandLandmarker, FilesetResolver } = tasksVision;
        // Local assets — see the note in MediaPipeCVEngine. A gesture engine
        // that needs the internet to start is useless on an offline kiosk.
        const vision = await FilesetResolver.forVisionTasks(this.wasmPath);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: this.modelPath,
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          numHands: 1,
        });
        this._initialized = true;
      }
    } catch (err) {
      console.warn('MediaPipeGestureEngine: HandLandmarker failed to load or fallback to Mock:', err);
      // Fail gracefully — isInitialized remains false
    }
  }

  public async processFrame(frame: FrameInput): Promise<GestureState> {
    if (!this._initialized || !this.handLandmarker) {
      return {
        timestamp: frame.timestamp,
        gesture: 'NONE',
        confidence: 0,
      };
    }

    try {
      let inputSource: any = frame.data;
      if (frame.data instanceof Uint8ClampedArray) {
        inputSource = new ImageData(
          frame.data as unknown as Uint8ClampedArray<ArrayBuffer>,
          frame.width,
          frame.height
        );
      }

      const results = this.handLandmarker.detect(inputSource);
      if (!results || !results.landmarks || results.landmarks.length === 0 || !results.landmarks[0]) {
        return this.smoothing.smooth({
          timestamp: frame.timestamp,
          gesture: 'NONE',
          confidence: 0,
        });
      }

      const rawLms = results.landmarks[0];
      const landmarks: HandLandmark[] = rawLms.map((lm: any, idx: number) => ({
        id: idx,
        x: lm.x,
        y: lm.y,
        z: lm.z || 0,
      }));

      const classified = this.classifier.classify(landmarks);
      const handedness = results.handednesses?.[0]?.[0]?.categoryName as 'Left' | 'Right' | undefined;

      const rawState: GestureState = {
        timestamp: frame.timestamp,
        gesture: classified.gesture,
        confidence: classified.confidence,
        handedness,
        landmarks,
      };

      return this.smoothing.smooth(rawState);
    } catch (err) {
      return {
        timestamp: frame.timestamp,
        gesture: 'NONE',
        confidence: 0,
      };
    }
  }

  public async dispose(): Promise<void> {
    if (this.handLandmarker) {
      try {
        this.handLandmarker.close();
      } catch (e) {
        // ignore
      }
      this.handLandmarker = null;
    }
    this.smoothing.reset();
    this._initialized = false;
  }
}
