import { FacePose, FaceQualityResult } from './face.js';

export interface TargetTolerance {
  target: number;
  tolerance: number;
}

export interface PoseTarget {
  yaw?: TargetTolerance;
  pitch?: TargetTolerance;
  roll?: TargetTolerance;
}

export type CaptureSensitivity = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface QualityRequirement {
  minFaceSizeRatio?: number;
  maxFaceSizeRatio?: number;
  maxCenterOffsetX?: number;
  maxCenterOffsetY?: number;
  minBrightness?: number;
  maxBrightness?: number;
  minSharpness?: number;
  /**
   * Floor on `eyeOpenScore` (1 - blink blendshape). An ID photo with shut or
   * squinting eyes fails identity verification later, not just this check.
   */
  minEyeOpenScore?: number;
  /**
   * Ceiling on `smileScore` (mouth-smile blendshape). ID photos require a
   * neutral expression; this is deliberately a ceiling rather than a
   * require-exact-zero, since a faint, natural mouth shape still reads as a
   * nonzero smile blendshape on most faces at rest.
   */
  maxSmileScore?: number;
  sensitivity?: CaptureSensitivity;
}

export type StepType = 'FRONT' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'CUSTOM';

export interface CaptureStep {
  id: string;
  type: StepType;
  instruction: string;
  pose?: PoseTarget;
  quality?: QualityRequirement;
  sensitivity?: CaptureSensitivity;
  stability?: {
    durationMs: number;
  };
  countdown?: {
    enabled: boolean;
    durationMs: number;
  };
  timeoutMs?: number;
  capture: {
    enabled: boolean;
  };
  /**
   * Whether the shoulder-level posture check gates this step's capture.
   * Defaults to true. Turning the head 40-90 degrees for a LEFT/RIGHT step
   * legitimately rotates the projected shoulder line and can also take one
   * shoulder out of camera view — neither is a real posture problem, so
   * those steps should set this to false.
   */
  postureCheck?: boolean;
}

export interface CaptureWorkflow {
  id: string;
  name: string;
  version: number;
  description?: string;
  sensitivity?: CaptureSensitivity;
  steps: CaptureStep[];
  globalQuality?: QualityRequirement;
}

export type GuidanceStatus =
  | 'INITIALIZING'
  | 'SEARCHING_FACE'
  | 'MULTIPLE_FACES'
  | 'POSITIONING'
  | 'ADJUSTING'
  | 'READY'
  | 'STABILIZING'
  | 'COUNTDOWN'
  | 'CAPTURING'
  | 'VALIDATING'
  | 'SUCCESS'
  | 'ERROR';

export type GuidancePriorityReason =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'FACE_TOO_LARGE'
  | 'FACE_RESOLUTION_TOO_LOW'
  | 'OFF_CENTER'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'LOOK_UP'
  | 'LOOK_DOWN'
  | 'TILT_CORRECT'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'BLURRY'
  | 'OCCLUDED'
  | 'EYES_CLOSED'
  | 'SMILING'
  | 'SHOULDERS_TILTED'
  | 'SHOULDERS_NOT_VISIBLE'
  | 'HOLD_STILL'
  | 'READY';

export interface GuidanceHint {
  code: GuidancePriorityReason;
  message: string;
}

export interface GuidanceState {
  status: GuidanceStatus;
  primaryInstruction: string;
  primaryReason: GuidancePriorityReason;
  progress: number;
  hints: GuidanceHint[];
  currentStepIndex: number;
  totalSteps: number;
  stepId: string;
  stepType: StepType;
  stabilizingMs?: number;
  countdownValue?: number;
}

export interface CaptureStepResult {
  stepId: string;
  stepType: StepType;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  attempts: number;
  capturedImagePath?: string;
  pose?: FacePose;
  quality?: FaceQualityResult;
  timestamp?: number;
}

export interface CaptureSession {
  id: string;
  personId?: string;
  workflowId: string;
  workflowVersion: number;
  startedAt: number;
  completedAt?: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  steps: CaptureStepResult[];
}
