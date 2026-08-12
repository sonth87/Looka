import {
  CaptureSession,
  CaptureStepResult,
  CaptureWorkflow,
  FaceState,
  GuidanceState,
  WorkflowEngine as IWorkflowEngine,
} from '@face/core';
import { StepEvaluator } from './StepEvaluator.js';
import { StabilityTracker } from './StabilityTracker.js';
import { GuidanceEngine } from './GuidanceEngine.js';
import { CaptureController } from './CaptureController.js';

export class WorkflowEngine implements IWorkflowEngine {
  private _currentSession: CaptureSession | null = null;
  private _currentState: GuidanceState;
  private activeWorkflow: CaptureWorkflow | null = null;
  private currentStepIdx = 0;
  private stepStartTime = 0;

  private stepEvaluator = new StepEvaluator();
  private stabilityTracker = new StabilityTracker();
  private guidanceEngine = new GuidanceEngine();
  private captureController = new CaptureController();

  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor() {
    this._currentState = {
      status: 'INITIALIZING',
      primaryInstruction: 'Sẵn sàng khởi tạo quy trình',
      primaryReason: 'NO_FACE',
      progress: 0,
      hints: [],
      currentStepIndex: 0,
      totalSteps: 0,
      stepId: '',
      stepType: 'FRONT',
    };
  }

  public get currentSession(): CaptureSession | null {
    return this._currentSession;
  }

  public get currentState(): GuidanceState {
    return this._currentState;
  }

  public async startSession(
    workflow: CaptureWorkflow,
    personId?: string
  ): Promise<CaptureSession> {
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow must contain at least one step.');
    }

    this.activeWorkflow = workflow;
    this.currentStepIdx = 0;
    this.stepStartTime = Date.now();
    this.stabilityTracker.reset();

    const sessionId = `session_${Date.now()}`;
    const initialStepResults: CaptureStepResult[] = workflow.steps.map((step) => ({
      stepId: step.id,
      stepType: step.type,
      status: 'PENDING',
      attempts: 0,
    }));

    this._currentSession = {
      id: sessionId,
      personId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      startedAt: Date.now(),
      status: 'RUNNING',
      steps: initialStepResults,
    };

    const firstStep = workflow.steps[0];
    this._currentState = {
      status: 'SEARCHING_FACE',
      primaryInstruction: firstStep.instruction,
      primaryReason: 'NO_FACE',
      progress: 0,
      hints: [],
      currentStepIndex: 0,
      totalSteps: workflow.steps.length,
      stepId: firstStep.id,
      stepType: firstStep.type,
    };

    this.emit('state-change', this._currentState);
    return this._currentSession;
  }

  public async processFrame(faceState: FaceState): Promise<GuidanceState> {
    if (!this._currentSession || !this.activeWorkflow || this._currentSession.status !== 'RUNNING') {
      return this._currentState;
    }

    const currentStep = this.activeWorkflow.steps[this.currentStepIdx];
    if (!currentStep) return this._currentState;

    // Check step timeout
    if (currentStep.timeoutMs && currentStep.timeoutMs > 0) {
      const elapsed = Date.now() - this.stepStartTime;
      if (elapsed > currentStep.timeoutMs) {
        this.updateStepStatus(currentStep.id, 'FAILED');
        this.emit('failed', { stepId: currentStep.id, reason: 'TIMEOUT' });
        await this.cancelSession();
        return this._currentState;
      }
    }

    // 1. Evaluate Step gates
    const evalResult = this.stepEvaluator.evaluate(faceState, currentStep);

    // 2. Track Stability
    const stabilityDuration = currentStep.stability?.durationMs ?? 500;
    const stability = this.stabilityTracker.update(evalResult.passed, stabilityDuration);

    // 3. Evaluate Guidance
    const statusOverride = stability.isStable
      ? 'CAPTURING'
      : stability.progress > 0
      ? 'STABILIZING'
      : undefined;

    const guidance = this.guidanceEngine.evaluateGuidance(
      faceState,
      currentStep,
      evalResult,
      statusOverride,
      stability.progress
    );

    guidance.currentStepIndex = this.currentStepIdx;
    guidance.totalSteps = this.activeWorkflow.steps.length;
    this._currentState = guidance;

    // 4. Trigger Auto-Capture if Stable
    if (stability.isStable && currentStep.capture.enabled) {
      this.stabilityTracker.reset();
      const captureResult = await this.captureController.captureCurrentFrame();

      const valid = await this.captureController.validateCapturedImage(
        captureResult.imagePath,
        currentStep.quality || {}
      );

      if (valid) {
        this.updateStepStatus(currentStep.id, 'COMPLETED', captureResult.imagePath, faceState);
        this.emit('capture-trigger', {
          stepId: currentStep.id,
          imagePath: captureResult.imagePath,
        });

        await this.advanceToNextStep();
      } else {
        const stepResult = this._currentSession.steps.find((s) => s.stepId === currentStep.id);
        if (stepResult) stepResult.attempts++;
      }
    }

    this.emit('state-change', this._currentState);
    return this._currentState;
  }

  public async cancelSession(): Promise<void> {
    if (this._currentSession) {
      this._currentSession.status = 'CANCELLED';
      this._currentSession.completedAt = Date.now();
    }
    this.activeWorkflow = null;
    this.stabilityTracker.reset();
    this._currentState.status = 'ERROR';
    this._currentState.primaryInstruction = 'Đã hủy quy trình';
    this.emit('state-change', this._currentState);
  }

  public async retryStep(): Promise<void> {
    if (!this._currentSession || !this.activeWorkflow) return;
    this.stabilityTracker.reset();
    this.stepStartTime = Date.now();
    const step = this.activeWorkflow.steps[this.currentStepIdx];
    if (step) {
      const result = this._currentSession.steps.find((s) => s.stepId === step.id);
      if (result) {
        result.status = 'PENDING';
        result.attempts++;
      }
    }
  }

  public async skipStep(): Promise<void> {
    if (!this._currentSession || !this.activeWorkflow) return;
    const step = this.activeWorkflow.steps[this.currentStepIdx];
    if (step) {
      this.updateStepStatus(step.id, 'SKIPPED');
      await this.advanceToNextStep();
    }
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((listener) => listener(...args));
    }
  }

  private async advanceToNextStep(): Promise<void> {
    if (!this.activeWorkflow || !this._currentSession) return;

    this.currentStepIdx++;
    this.stepStartTime = Date.now();
    this.stabilityTracker.reset();

    if (this.currentStepIdx >= this.activeWorkflow.steps.length) {
      // Completed all steps
      this._currentSession.status = 'COMPLETED';
      this._currentSession.completedAt = Date.now();
      this._currentState.status = 'SUCCESS';
      this._currentState.primaryInstruction = 'Hoàn thành chụp ảnh!';
      this._currentState.progress = 1.0;
      this.emit('completed', this._currentSession);
    } else {
      const nextStep = this.activeWorkflow.steps[this.currentStepIdx];
      this._currentState = {
        status: 'POSITIONING',
        primaryInstruction: nextStep.instruction,
        primaryReason: 'NO_FACE',
        progress: 0,
        hints: [],
        currentStepIndex: this.currentStepIdx,
        totalSteps: this.activeWorkflow.steps.length,
        stepId: nextStep.id,
        stepType: nextStep.type,
      };
    }
  }

  private updateStepStatus(
    stepId: string,
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED',
    imagePath?: string,
    faceState?: FaceState
  ): void {
    if (!this._currentSession) return;
    const stepResult = this._currentSession.steps.find((s) => s.stepId === stepId);
    if (stepResult) {
      stepResult.status = status;
      stepResult.capturedImagePath = imagePath;
      stepResult.pose = faceState?.pose;
      stepResult.quality = faceState?.quality;
      stepResult.timestamp = Date.now();
    }
  }
}
