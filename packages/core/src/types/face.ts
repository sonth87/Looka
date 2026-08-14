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
   * Null until something actually looks.
   *
   * Nothing in the pipeline detects eyelids, mouths or occlusion today. These
   * were hardcoded to "eyes visible, not occluded", which reported a masked or
   * closed-eyed face as fully verified — a claim no code had earned.
   */
  eyesVisible: boolean | null;
  mouthVisible: boolean | null;
  occluded: boolean | null;
  reasons: string[];
}

export interface FaceDetection {
  boundingBox: BoundingBox;
  confidence: number;
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
  /** Estimated standing distance. Null when it could not be measured. */
  distance?: FaceDistance | null;
  landmarks?: FaceLandmark[];
  confidence?: number;
  /** Input frame dimensions */
  frameWidth?: number;
  frameHeight?: number;
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

