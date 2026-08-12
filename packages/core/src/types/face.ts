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
  sharpness: number;
  brightness: number;
  faceSizeRatio: number;
  centerXOffset: number;
  centerYOffset: number;
  eyesVisible: boolean;
  mouthVisible: boolean;
  occluded: boolean;
  reasons: string[];
}

export interface FaceDetection {
  boundingBox: BoundingBox;
  confidence: number;
}

export type FacePresenceState = 'NO_FACE' | 'SINGLE_FACE' | 'MULTIPLE_FACES';

export interface FaceState {
  timestamp: number;
  detected: boolean;
  faceCount: number;
  presence: FacePresenceState;
  detection?: FaceDetection;
  center?: Point2D;
  pose?: FacePose;
  quality?: FaceQualityResult;
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

