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

/**
 * A logical camera slot on the kiosk. The desktop app maps each role to one
 * physical camera in its Camera Setup screen. CENTER is mandatory.
 */
export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

export const CAMERA_ROLES: readonly CameraRole[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];

/**
 * Used when a `CaptureStep` does not set `cameraRole` explicitly.
 */
export function defaultCameraRoleForStepType(type: StepType): CameraRole {
  switch (type) {
    case 'FRONT':
      return 'CENTER';
    case 'LEFT':
      return 'LEFT';
    case 'RIGHT':
      return 'RIGHT';
    case 'UP':
      return 'UP';
    case 'DOWN':
      return 'DOWN';
    default:
      return 'CENTER';
  }
}

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
  /**
   * Which logical camera this frame *prefers* to be captured by. Defaults
   * per `defaultCameraRoleForStepType(type)`. As of the 2026-09-08 product
   * decision (see docs/plans/campaign-config-sso-card-photo-discussion.md
   * §3.1.5/§3.9), this is a preference, not a hard requirement — the kiosk
   * decides at runtime (in its own sequential/simultaneous setting) whether
   * a physical camera is actually mapped to this role; if not, it falls
   * back to CENTER with a re-derived "gate" pose target and the subject
   * turns their head instead. A campaign is never blocked from being
   * created or run by how many cameras a given kiosk happens to have.
   */
  cameraRole?: CameraRole;
  /**
   * Foreign key into the (server-side, CMS-managed) dynamic angle catalog
   * this step was created from — see §3.1.6 of the discussion doc above.
   * `CaptureStep` itself still carries a full, self-contained snapshot of
   * `pose`/`instruction`/`cameraRole` at the time the campaign saved this
   * row (so a later edit to the catalog entry never silently changes a
   * running campaign's steps) — `angleCode` is purely a display/traceability
   * link back to that catalog entry, never re-read at capture time. Absent
   * on steps created before the catalog existed, or on ad-hoc `CUSTOM`
   * steps not backed by any catalog entry.
   */
  angleCode?: string;
  /**
   * Marks the one step in a workflow whose captured photo is the source for
   * the derived 4x6 ID card photo (crop/background/retouch pipeline — see
   * the discussion doc §3.5). Exactly one step per workflow should set this
   * to true; enforced by `capture-angles.validator.ts` on the API side, not
   * by this type.
   */
  isCardSource?: boolean;
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
