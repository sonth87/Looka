import { FaceDetection, FaceLandmark, FaceState } from '../types/face.js';
import { FaceEmbedding, LivenessResult } from '../types/biometric.js';

export interface FrameInput {
  data: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | Uint8ClampedArray;
  width: number;
  height: number;
  timestamp: number;
}

export interface AlignedFace {
  data: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | Uint8ClampedArray;
  width: number;
  height: number;
  landmarks: FaceLandmark[];
  cropBox: { x: number; y: number; width: number; height: number };
}

export interface LivenessInput {
  frame: FrameInput;
  faceState: FaceState;
  history?: FaceState[];
}

export interface FaceDetector {
  initialize(): Promise<void>;
  detect(frame: FrameInput): Promise<FaceDetection[]>;
  dispose(): Promise<void>;
}

export interface FaceEmbedder {
  initialize(): Promise<void>;
  embed(face: AlignedFace): Promise<FaceEmbedding>;
  dispose(): Promise<void>;
}

export interface LivenessDetector {
  initialize(): Promise<void>;
  evaluate(input: LivenessInput): Promise<LivenessResult>;
  dispose(): Promise<void>;
}

export interface CVEngine {
  readonly name: string;
  readonly isInitialized: boolean;
  initialize(): Promise<void>;
  processFrame(frame: FrameInput): Promise<FaceState>;
  align(frame: FrameInput, faceState: FaceState): Promise<AlignedFace>;
  dispose(): Promise<void>;
}
