import { FaceState } from '../types/face.js';
import {
  CaptureStep,
  CaptureWorkflow,
  GuidanceState,
  QualityRequirement,
  CaptureSession,
} from '../types/workflow.js';

export interface StepEvaluationResult {
  passed: boolean;
  presenceValid: boolean;
  poseValid: boolean;
  qualityValid: boolean;
  positionValid: boolean;
  sizeValid: boolean;
  reasons: string[];
}

export interface StepEvaluator {
  evaluate(faceState: FaceState, step: CaptureStep): StepEvaluationResult;
}

export interface StabilityTracker {
  reset(): void;
  update(isConditionMet: boolean, durationMs: number): { isStable: boolean; elapsedMs: number; progress: number };
}

export interface GuidanceEngine {
  evaluateGuidance(faceState: FaceState, step: CaptureStep, evaluation: StepEvaluationResult): GuidanceState;
}

export interface WorkflowEngine {
  readonly currentSession: CaptureSession | null;
  readonly currentState: GuidanceState;
  /** Step whose photo is being replaced, or null while the workflow runs in order. */
  readonly retakingStepId: string | null;

  startSession(workflow: CaptureWorkflow, personId?: string): Promise<CaptureSession>;
  processFrame(faceState: FaceState): Promise<GuidanceState>;
  cancelSession(): Promise<void>;
  retryStep(): Promise<void>;
  /** Re-enter an already visited step to replace its photo. Resolves false if the step is not retakable. */
  retakeStep(stepId: string): Promise<boolean>;
  skipStep(): Promise<void>;

  on(
    event: 'state-change' | 'capture-trigger' | 'completed' | 'failed' | 'step-retaken',
    listener: (...args: any[]) => void
  ): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

export interface CaptureController {
  captureCurrentFrame(): Promise<{ imagePath: string; capturedAt: number }>;
  validateCapturedImage(imagePath: string, requirement: QualityRequirement): Promise<boolean>;
}
