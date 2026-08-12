import {
  AlignedFace,
  CVEngine,
  CaptureSensitivity,
  FaceDetection,
  FaceLandmark,
  FacePlatformError,
  FacePresenceState,
  FaceState,
  FrameInput,
  ERROR_CODES,
} from '@face/core';
import { QualityEvaluator } from '@face/face-quality';
import { PoseEstimator } from './PoseEstimator.js';

export interface MediaPipeCVEngineOptions {
  wasmPath?: string;
  modelPath?: string;
  delegate?: 'CPU' | 'GPU';
  minDetectionConfidence?: number;
  minPresenceConfidence?: number;
  minTrackingConfidence?: number;
  emaAlpha?: number;
}

export class MediaPipeCVEngine implements CVEngine {
  public readonly name = 'MediaPipeCVEngine';
  private _initialized = false;
  private landmarker: any = null;
  private poseEstimator: PoseEstimator;
  private qualityEvaluator: QualityEvaluator;
  private options: MediaPipeCVEngineOptions;
  private sensitivity: CaptureSensitivity = 'MEDIUM';

  constructor(options: MediaPipeCVEngineOptions = {}) {
    this.options = {
      delegate: 'GPU',
      minDetectionConfidence: 0.5,
      minPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      emaAlpha: 0.3,
      ...options,
    };
    this.poseEstimator = new PoseEstimator(this.options.emaAlpha);
    this.qualityEvaluator = new QualityEvaluator();
  }

  public setSensitivity(sensitivity: CaptureSensitivity): void {
    this.sensitivity = sensitivity;
  }

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      // Dynamic import of @mediapipe/tasks-vision
      const vision = await import('@mediapipe/tasks-vision');
      const { FaceLandmarker, FilesetResolver } = vision;

      const wasmFileset = await FilesetResolver.forVisionTasks(
        this.options.wasmPath || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      const modelAssetPath =
        this.options.modelPath ||
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

      this.landmarker = await FaceLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate: this.options.delegate,
        },
        runningMode: 'IMAGE',
        numFaces: 5,
        minFaceDetectionConfidence: this.options.minDetectionConfidence,
        minFacePresenceConfidence: this.options.minPresenceConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      this._initialized = true;
    } catch (err: any) {
      throw new FacePlatformError(
        ERROR_CODES.CV_MODEL_INIT_FAILED,
        `Failed to initialize MediaPipe FaceLandmarker: ${err.message || err}`,
        'CV_ENGINE',
        true,
        { originalError: err }
      );
    }
  }

  public async processFrame(frame: FrameInput): Promise<FaceState> {
    if (!this._initialized || !this.landmarker) {
      throw new FacePlatformError(
        ERROR_CODES.CV_MODEL_INIT_FAILED,
        'MediaPipeCVEngine is not initialized.',
        'CV_ENGINE'
      );
    }

    try {
      // Perform MediaPipe detection
      let inputSource: any = frame.data;
      if (frame.data instanceof Uint8ClampedArray) {
        inputSource = new ImageData(
          frame.data as unknown as Uint8ClampedArray<ArrayBuffer>,
          frame.width,
          frame.height
        );
      }
      const results = this.landmarker.detect(inputSource);
      const faceCount = results?.faceLandmarks?.length || 0;
      const presence: FacePresenceState =
        faceCount === 0 ? 'NO_FACE' : faceCount === 1 ? 'SINGLE_FACE' : 'MULTIPLE_FACES';

      if (faceCount === 0 || !results.faceLandmarks[0]) {
        this.poseEstimator.reset();
        return {
          timestamp: frame.timestamp,
          detected: false,
          faceCount: 0,
          presence: 'NO_FACE',
        };
      }

      // Convert 0..1 normalized MediaPipe landmarks for ALL detected faces
      const allLandmarks: FaceLandmark[][] = results.faceLandmarks.map((faceLms: any[]) =>
        faceLms.map((lm: any, idx: number) => ({
          id: idx,
          x: lm.x,
          y: lm.y,
          z: lm.z || 0,
        }))
      );

      const allDetections: FaceDetection[] = allLandmarks.map((lms) => {
        let minX = 1,
          maxX = 0,
          minY = 1,
          maxY = 0;
        for (const lm of lms) {
          if (lm.x < minX) minX = lm.x;
          if (lm.x > maxX) maxX = lm.x;
          if (lm.y < minY) minY = lm.y;
          if (lm.y > maxY) maxY = lm.y;
        }
        return {
          boundingBox: {
            x: Math.round(minX * frame.width),
            y: Math.round(minY * frame.height),
            width: Math.round((maxX - minX) * frame.width),
            height: Math.round((maxY - minY) * frame.height),
          },
          confidence: 0.95,
        };
      });

      // Primary face is the first detected face
      const landmarks = allLandmarks[0];
      const detection = allDetections[0];
      const boundingBox = detection.boundingBox;

      // Estimate Head Pose with EMA smoothing for primary face
      const pose = this.poseEstimator.estimatePose(landmarks);

      // Evaluate Quality for primary face
      const pixelData =
        frame.data instanceof Uint8ClampedArray ? frame.data : undefined;
      const quality = this.qualityEvaluator.evaluateQuality(
        boundingBox,
        frame.width,
        frame.height,
        pixelData,
        { sensitivity: this.sensitivity }
      );

      return {
        timestamp: frame.timestamp,
        detected: true,
        faceCount,
        presence,
        detection,
        center: {
          x: boundingBox.x + boundingBox.width / 2,
          y: boundingBox.y + boundingBox.height / 2,
        },
        pose,
        quality,
        landmarks,
        frameWidth: frame.width,
        frameHeight: frame.height,
        allDetections,
        allLandmarks,
        confidence: 0.95,
      };
    } catch (err: any) {
      throw new FacePlatformError(
        ERROR_CODES.CV_INFERENCE_FAILED,
        `MediaPipe inference failed: ${err.message || err}`,
        'CV_ENGINE',
        false,
        { originalError: err }
      );
    }
  }

  public async align(frame: FrameInput, faceState: FaceState): Promise<AlignedFace> {
    if (!faceState.detected || !faceState.detection || !faceState.landmarks) {
      throw new FacePlatformError(
        ERROR_CODES.CV_INFERENCE_FAILED,
        'Cannot align face without detection & landmarks.',
        'CV_ENGINE'
      );
    }

    return {
      data: frame.data,
      width: faceState.detection.boundingBox.width,
      height: faceState.detection.boundingBox.height,
      landmarks: faceState.landmarks,
      cropBox: faceState.detection.boundingBox,
    };
  }

  public async dispose(): Promise<void> {
    if (this.landmarker) {
      this.landmarker.close?.();
      this.landmarker = null;
    }
    this.poseEstimator.reset();
    this._initialized = false;
  }
}
