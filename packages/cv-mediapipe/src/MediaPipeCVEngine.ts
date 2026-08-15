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
import { QualityEvaluator, estimateDistance } from '@face/face-quality';
import { PoseEstimator } from './PoseEstimator.js';
import { poseFromTransformationMatrix } from './HeadPoseMatrix.js';

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
  private lastVideoTimestamp = 0;

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

      // Local by default. Fetching the runtime from a CDN at startup would make
      // an offline-first kiosk fail exactly when it is supposed to keep working;
      // the assets are collected into the app by scripts/fetch-assets.mjs.
      // Callers hosting them elsewhere can still override both paths.
      const wasmFileset = await FilesetResolver.forVisionTasks(
        this.options.wasmPath || './wasm'
      );

      const modelAssetPath = this.options.modelPath || './models/face_landmarker.task';

      this.landmarker = await FaceLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate: this.options.delegate,
        },
        // VIDEO rather than IMAGE: IMAGE re-runs full face detection on every
        // frame with no memory of the last one, while VIDEO tracks between
        // frames and only re-detects when tracking is lost. On a live preview
        // that is the difference between detecting a face and detecting the
        // same face thirty times a second.
        runningMode: 'VIDEO',
        // Enough to notice a second person — which is all the presence check
        // needs — without paying to landmark five faces every frame.
        numFaces: 2,
        minFaceDetectionConfidence: this.options.minDetectionConfidence,
        minFacePresenceConfidence: this.options.minPresenceConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
        outputFaceBlendshapes: false,
        // The solved 3D pose. Without it, pitch has to be inferred from how far
        // the nose sits below the eye line, a signal so small that a clearly
        // bowed head moved it about 1.5% — inside landmark noise.
        outputFacialTransformationMatrixes: true,
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

      // detectForVideo needs strictly increasing timestamps; a repeated or
      // out-of-order value makes MediaPipe drop the frame silently, which looks
      // exactly like the tracker freezing.
      const ts = frame.timestamp > this.lastVideoTimestamp
        ? frame.timestamp
        : this.lastVideoTimestamp + 1;
      this.lastVideoTimestamp = ts;

      // The pose maths needs the frame shape to compare x against y; the real
      // resolution is only known once frames start arriving.
      this.poseEstimator.setFrameSize(frame.width, frame.height);

      const results = this.landmarker.detectForVideo(inputSource, ts);
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

      // Prefer the solved 3D pose; fall back to the 2D estimate when MediaPipe
      // returns no matrix, so a runtime that lacks it still reports something
      // rather than nothing.
      const matrix = results?.facialTransformationMatrixes?.[0]?.data;
      const solved = poseFromTransformationMatrix(matrix);
      const pose = solved
        ? this.poseEstimator.smooth(solved)
        : this.poseEstimator.estimatePose(landmarks);

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

      // Standing distance, derived from how much of the frame the face spans.
      // Exposed so guidance can say "step back" with a number behind it rather
      // than only reacting once a threshold has already been crossed.
      const distanceEstimate = estimateDistance(boundingBox, frame.width);

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
        distance: distanceEstimate
          ? {
              minMeters: distanceEstimate.minMeters,
              maxMeters: distanceEstimate.maxMeters,
              meters: distanceEstimate.meters,
            }
          : null,
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
    this.lastVideoTimestamp = 0;
    this._initialized = false;
  }
}
