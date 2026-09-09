export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface FaceLandmark extends Point3D {
  id?: number;
  name?: string;
}

export interface FacePose {
  /** Yaw angle in degrees (-90 to +90). Negative = left, Positive = right. */
  yaw: number;
  /** Pitch angle in degrees (-90 to +90). Positive = up, Negative = down. */
  pitch: number;
  /** Roll angle in degrees (-90 to +90). Negative = tilt left, Positive = tilt right. */
  roll: number;
}

export interface FaceQualityResult {
  overallScore: number;
  accepted: boolean;
  /**
   * Null when no pixels were available to measure from.
   *
   * These used to fall back to flattering constants, so a caller with no frame
   * data was told the image was sharp and well lit. A number here means it was
   * measured; anything else has to be treated as unknown, not as good.
   */
  sharpness: number | null;
  brightness: number | null;
  faceSizeRatio: number;
  centerXOffset: number;
  centerYOffset: number;
  /**
   * 1 - the eye-blink blendshape (averaged over both eyes). Null when no
   * blendshapes were handed in — this package has no pixel-based way to
   * measure it, unlike brightness/sharpness.
   */
  eyeOpenScore: number | null;
  /** The mouth-smile blendshape, averaged over both sides. Null likewise. */
  smileScore: number | null;
  /**
   * Face width/height in pixels, on the resolution the capture will actually
   * be SAVED at — not `frameWidth`/`frameHeight` above when those come from a
   * downscaled analysis frame (see FrameInput.nativeWidth's doc comment).
   * Backs `FACE_RESOLUTION_TOO_LOW` (§2.8 of
   * docs/plans/multi-camera-device-management-discussion.md): a face can
   * clear `faceSizeRatio`'s floor and still be too few real pixels to print
   * or match reliably.
   */
  faceWidthPx: number;
  faceHeightPx: number;
  /**
   * `eyeOpenScore` against `minEyeOpenScore`. Kept as its own boolean, next to
   * the raw score, in the same shape as brightness/sharpness passing their
   * own thresholds.
   *
   * Null until something actually looks. Nothing in the pipeline detects
   * mouths or occlusion today. These were hardcoded to "eyes visible, not
   * occluded", which reported a masked or closed-eyed face as fully verified
   * — a claim no code had earned.
   */
  eyesVisible: boolean | null;
  mouthVisible: boolean | null;
  occluded: boolean | null;
  /** `smileScore` against `maxSmileScore`. Null under the same rule as `eyesVisible`. */
  neutralExpression: boolean | null;
  reasons: string[];
}

export interface FaceDetection {
  boundingBox: BoundingBox;
  confidence: number;
}

/**
 * Shoulder-level check from a body-pose model (MediaPipe PoseLandmarker),
 * separate from `FaceQualityResult`: it answers a different question — is
 * the SUBJECT positioned correctly — not whether the face image itself is
 * usable, and it comes from an entirely different model with its own
 * detection failure mode (shoulders out of frame, not "face rejected").
 */
export interface BodyPostureResult {
  /** Angle of the shoulder line from horizontal, in degrees. Positive = right shoulder lower. Null when shoulders were not detected confidently enough to trust. */
  shoulderRoll: number | null;
  /** Both shoulder landmarks were detected above the visibility floor. Null until a pose was actually looked for. */
  shouldersVisible: boolean | null;
  /** `shoulderRoll` within tolerance. Null under the same rule as `shouldersVisible`. */
  leveled: boolean | null;
  reasons: string[];
}

export type FacePresenceState = 'NO_FACE' | 'SINGLE_FACE' | 'MULTIPLE_FACES';

/**
 * How far the subject is standing, in metres.
 *
 * A band rather than a figure: it is derived from how much of the frame the
 * face spans, and both inputs to that — real face width and the camera's field
 * of view — vary by around 10% and are rarely published. Null when nothing was
 * detected to measure.
 */
export interface FaceDistance {
  minMeters: number;
  maxMeters: number;
  meters: number;
}

export interface FaceState {
  timestamp: number;
  detected: boolean;
  faceCount: number;
  presence: FacePresenceState;
  detection?: FaceDetection;
  center?: Point2D;
  pose?: FacePose;
  quality?: FaceQualityResult;
  /** Shoulder-level check from a body-pose model. Null when nothing looked (no pose model available, or no body detected). */
  posture?: BodyPostureResult | null;
  /** Estimated standing distance. Null when it could not be measured. */
  distance?: FaceDistance | null;
  landmarks?: FaceLandmark[];
  confidence?: number;
  /** Input frame dimensions — the (possibly downscaled) analysis frame. */
  frameWidth?: number;
  frameHeight?: number;
  /**
   * The camera's native resolution — what the saved capture will actually
   * use — when it differs from `frameWidth`/`frameHeight` above. See
   * FrameInput.nativeWidth's doc comment. Undefined falls back to
   * `frameWidth`/`frameHeight` wherever this is consumed.
   */
  captureFrameWidth?: number;
  captureFrameHeight?: number;
  /** List of all face detections when faceCount > 1 */
  allDetections?: FaceDetection[];
  /** List of landmark arrays for all detected faces */
  allLandmarks?: FaceLandmark[][];
}

export type GestureType =
  | 'VICTORY'
  | 'THUMBS_UP'
  | 'OPEN_PALM'
  | 'CLOSED_FIST'
  | 'OK_SIGN'
  | 'NONE';

export interface HandLandmark extends Point3D {
  id?: number;
  name?: string;
}

export interface GestureState {
  timestamp: number;
  gesture: GestureType;
  confidence: number;
  handedness?: 'Left' | 'Right';
  landmarks?: HandLandmark[];
}

export type CaptureTriggerMode = 'AUTO' | 'MANUAL' | 'OFF';

export interface CaptureTriggerConfig {
  mode: CaptureTriggerMode;
  autoHoldMs: number;
  allowedGestures: GestureType[];
}

/**
 * What actually fired a given capture — recorded per-photo for the
 * auto-vs-manual statistics feature (docs/plans/campaign-config-sso-card-photo-discussion.md
 * §3.7). Distinct from `CaptureTriggerMode` (the kiosk-wide *setting* that
 * was active): `AUTO`/`GESTURE`/`SHUTTER` are the three ways a step can
 * actually complete under that setting (mirroring
 * `CaptureTriggerEvaluator`'s `AUTO_STABILITY_REACHED` /
 * `MANUAL_GESTURE_<X>` / `SHUTTER_BUTTON_CLICKED` reasons), and `EXTERNAL`
 * covers a side-camera frame captured via `WorkflowEngine.recordExternalCapture`
 * when the CENTER frame's own trigger fires in simultaneous-capture mode —
 * it never has its own independent trigger.
 */
export type CaptureTriggerSource = 'AUTO' | 'GESTURE' | 'SHUTTER' | 'EXTERNAL';

