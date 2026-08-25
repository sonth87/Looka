import {
  AlignedFace,
  BodyPostureResult,
  CVEngine,
  CaptureSensitivity,
  FaceDetection,
  FaceLandmark,
  FacePlatformError,
  FacePose,
  FacePresenceState,
  FaceQualityResult,
  FaceState,
  FrameInput,
  ERROR_CODES,
} from '@face/core';
import { DistanceEstimate, QualityEvaluator, estimateDistance } from '@face/face-quality';
import { PoseEstimator } from './PoseEstimator.js';
import { poseFromTransformationMatrix } from './HeadPoseMatrix.js';
import { evaluatePosture } from './BodyPostureEvaluator.js';

export interface MediaPipeCVEngineOptions {
  wasmPath?: string;
  modelPath?: string;
  /**
   * Body-pose model for the shoulder-level check. Optional in the sense that
   * its failure to load does not fail the whole engine — a kiosk without it
   * still runs, just without posture guidance — but the file itself is not
   * bundled unless scripts/fetch-assets.mjs has been run with it listed.
   */
  poseModelPath?: string;
  delegate?: 'CPU' | 'GPU';
  minDetectionConfidence?: number;
  minPresenceConfidence?: number;
  minTrackingConfidence?: number;
  emaAlpha?: number;
}

/**
 * Category names from MediaPipe's 52-blendshape ARKit-style output.
 * `eyeBlinkLeft`/`Right` run 0 (open) to 1 (fully closed); averaging both
 * sides keeps a one-eyed wink from reading as "eyes open".
 */
const EYE_BLINK_NAMES = ['eyeBlinkLeft', 'eyeBlinkRight'];
/** `mouthSmileLeft`/`Right` run 0 (neutral) to 1 (full smile). */
const MOUTH_SMILE_NAMES = ['mouthSmileLeft', 'mouthSmileRight'];

/** Mean score of the named categories; missing ones are skipped, not zeroed. */
function averageBlendshapes(
  categories: Array<{ categoryName: string; score: number }>,
  names: string[]
): number {
  const scores = names
    .map((name) => categories.find((c) => c.categoryName === name)?.score)
    .filter((score): score is number => typeof score === 'number');
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export class MediaPipeCVEngine implements CVEngine {
  public readonly name = 'MediaPipeCVEngine';
  private _initialized = false;
  private landmarker: any = null;
  /** Null when the model failed to load, or was never asked for — see initialize(). */
  private poseLandmarker: any = null;
  private poseEstimator: PoseEstimator;
  private qualityEvaluator: QualityEvaluator;
  private options: MediaPipeCVEngineOptions;
  private sensitivity: CaptureSensitivity = 'MEDIUM';
  /**
   * A synthetic, always-increasing frame counter — NOT wall-clock time.
   *
   * `detectForVideo()`'s timestamp only has to be strictly increasing per
   * task instance; it carries no meaning beyond that here. This used to be
   * `frame.timestamp` (Date.now(), real Unix epoch milliseconds — a 13-digit
   * number), which silently saturates at the WASM binding boundary: the
   * error logs were `Packet timestamp mismatch ... expected 2147483647001
   * but received 2147483647000` — exactly `2^31-1` (INT32_MAX) times 1000,
   * meaning every epoch-ms value this large gets clamped to INT32_MAX before
   * MediaPipe ever sees the real number, then converted to microseconds.
   * Once clamped, EVERY subsequent frame clamps to the same value too, so
   * the graph rejects every frame as a duplicate/out-of-order timestamp
   * forever — this had been silently degrading face tracking from the first
   * frame of any real session (any Date.now() value already exceeds
   * INT32_MAX milliseconds, which is only ~24.8 days since epoch), and
   * adding a second detectForVideo() call for PoseLandmarker below is what
   * turned "silently degraded" into loud, continuous graph errors. A small
   * counter starting at 0 never approaches that ceiling within any
   * realistic session (828 days at 30fps).
   */
  private lastVideoTimestamp = 0;
  /** Independent from `lastVideoTimestamp` — a separate task instance needs its own monotonic sequence, not the face landmarker's. */
  private lastPoseVideoTimestamp = 0;
  private lastLogAt = 0;
  /**
   * Shoulder position changes far slower than blinking or expression, and
   * running a second full model inference every frame roughly doubles this
   * engine's per-frame CV cost. Detected on every 3rd frame (~10fps at a
   * 30fps capture rate); `lastPosture` is what every frame in between
   * reports instead of leaving `posture` null on the frames it skips.
   */
  private poseFrameCounter = 0;
  private lastPosture: BodyPostureResult | null = null;

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
      const { FaceLandmarker, PoseLandmarker, FilesetResolver } = vision;

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
        // Drives eye-open / neutral-expression checks in QualityEvaluator — see
        // eyeOpenScore/smileScore below. Without this, an ID photo with shut
        // eyes or a big smile passes every existing gate silently.
        outputFaceBlendshapes: true,
        // The solved 3D pose. Without it, pitch has to be inferred from how far
        // the nose sits below the eye line, a signal so small that a clearly
        // bowed head moved it about 1.5% — inside landmark noise.
        outputFacialTransformationMatrixes: true,
      });

      this._initialized = true;

      // Best-effort: the shoulder-level check is additional guidance, not a
      // prerequisite for capturing a face. A kiosk whose asset bundle was
      // built before this model existed (or that failed to fetch it) still
      // has to run — posture just stays null on every frame instead.
      try {
        this.poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: this.options.poseModelPath || './models/pose_landmarker_lite.task',
            delegate: this.options.delegate,
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch (err: any) {
        console.log('[MediaPipeCVEngine] pose model unavailable, posture check disabled:', err?.message || err);
        this.poseLandmarker = null;
      }
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
      // exactly like the tracker freezing. Deliberately not frame.timestamp
      // (Date.now()) — see the doc comment on lastVideoTimestamp for why.
      const ts = ++this.lastVideoTimestamp;

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

      // Eye-open / expression signal for the primary face. Blendshapes are
      // reported per detected face in the same order as faceLandmarks, so
      // index 0 lines up with `landmarks` above.
      const blendshapes = results?.faceBlendshapes?.[0]?.categories;
      const eyeOpenScore = blendshapes ? 1 - averageBlendshapes(blendshapes, EYE_BLINK_NAMES) : null;
      const smileScore = blendshapes ? averageBlendshapes(blendshapes, MOUTH_SMILE_NAMES) : null;

      // Evaluate Quality for primary face
      const pixelData =
        frame.data instanceof Uint8ClampedArray ? frame.data : undefined;
      const quality = this.qualityEvaluator.evaluateQuality(
        boundingBox,
        frame.width,
        frame.height,
        pixelData,
        { sensitivity: this.sensitivity },
        { eyeOpenScore, smileScore }
      );

      // Standing distance, derived from how much of the frame the face spans.
      // Exposed so guidance can say "step back" with a number behind it rather
      // than only reacting once a threshold has already been crossed.
      const distanceEstimate = estimateDistance(boundingBox, frame.width);

      const posture = this.evaluatePostureThrottled(inputSource, frame.width / frame.height);

      this.logFrameSummary(faceCount, presence, solved !== null, pose, quality, distanceEstimate, posture);

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
        posture,
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

  /**
   * Runs the body-pose model every 3rd frame — see the doc comment on
   * `poseFrameCounter` for why — and reuses the previous result on the
   * frames in between rather than reporting null on 2 out of every 3 frames.
   */
  private evaluatePostureThrottled(inputSource: any, aspect: number): BodyPostureResult | null {
    if (!this.poseLandmarker) return null;

    this.poseFrameCounter++;
    if (this.poseFrameCounter % 3 !== 0) {
      return this.lastPosture;
    }

    try {
      const ts = ++this.lastPoseVideoTimestamp;
      const poseResults = this.poseLandmarker.detectForVideo(inputSource, ts);
      this.lastPosture = evaluatePosture(poseResults?.landmarks?.[0], aspect);
    } catch (err) {
      // A posture check failing is not a reason to fail the frame - the face
      // is what actually gates a capture; this is additional guidance on top.
      console.log('[MediaPipeCVEngine] pose detection failed:', (err as Error)?.message || err);
      this.lastPosture = null;
    }
    return this.lastPosture;
  }

  /**
   * Throttled to ~1/s: this is called once per processed frame (up to ~30/s),
   * so an unthrottled log would flood the console without adding anything a
   * developer could actually read. The per-module logs in PoseEstimator,
   * HeadPoseMatrix and QualityEvaluator carry the detail; this is the one line
   * that ties them to what actually reached the caller for this frame.
   */
  private logFrameSummary(
    faceCount: number,
    presence: FacePresenceState,
    poseSource: boolean,
    pose: FacePose,
    quality: FaceQualityResult,
    distance: DistanceEstimate | null,
    posture: BodyPostureResult | null
  ): void {
    const now = Date.now();
    if (now - this.lastLogAt < 1000) return;
    this.lastLogAt = now;
    console.log('[MediaPipeCVEngine] processFrame', {
      faceCount,
      presence,
      poseSource: poseSource ? '3D' : '2D',
      pose,
      quality: {
        accepted: quality.accepted,
        reasons: quality.reasons,
        brightness: quality.brightness,
        sharpness: quality.sharpness,
        eyeOpenScore: quality.eyeOpenScore,
        smileScore: quality.smileScore,
      },
      distanceMeters: distance?.meters ?? null,
      posture,
    });
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
    if (this.poseLandmarker) {
      this.poseLandmarker.close?.();
      this.poseLandmarker = null;
    }
    this.poseEstimator.reset();
    this.lastVideoTimestamp = 0;
    this.lastPoseVideoTimestamp = 0;
    this.poseFrameCounter = 0;
    this.lastPosture = null;
    this._initialized = false;
  }
}
