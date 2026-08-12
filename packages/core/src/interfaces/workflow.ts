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
  
  startSession(workflow: CaptureWorkflow, personId?: string): Promise<CaptureSession>;
  processFrame(faceState: FaceState): Promise<GuidanceState>;
  cancelSession(): Promise<void>;
  retryStep(): Promise<void>;
  skipStep(): Promise<void>;
  
  on(event: 'state-change' | 'capture-trigger' | 'completed' | 'failed', listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

export interface CaptureController {
  captureCurrentFrame(): Promise<{ imagePath: string; capturedAt: number }>;
  validateCapturedImage(imagePath: string, requirement: QualityRequirement): Promise<boolean>;
}
