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
