import {
  CaptureSession,
  CaptureSensitivity,
  CaptureStepResult,
  CaptureTriggerMode,
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
  /** Where ordered capture resumes once the running retake commits, if one is running. */
  private retakeReturnIdx: number | null = null;
  private stepStartTime = 0;
  private sensitivity: CaptureSensitivity = 'MEDIUM';
  private captureMode: CaptureTriggerMode = 'AUTO';
  private autoHoldMs: number | null = null;

  private stepEvaluator = new StepEvaluator();
  private stabilityTracker = new StabilityTracker();
  private guidanceEngine = new GuidanceEngine();
  private captureController = new CaptureController();

  /**
   * True while the step currently being retaken must be completed by the
   * caller's own `recordExternalCapture(...)` rather than this engine's own
   * capture path — set only by `retakeStep(stepId, { externalCapture: true })`,
   * which `FaceCaptureApp.handleRetakeStep` uses for a simultaneous-capture
   * side frame (§ desktop kiosk multi-camera capture, product decision
   * 2026-09-05 #3). A side frame's photo comes from its own physical camera,
   * never the one this engine's snapshot provider reads (see
   * `recordExternalCapture`'s own doc comment) — so neither
   * `triggerManualCapture` nor `processFrame`'s own AUTO-mode auto-fire may
   * complete that step themselves; see both for what this actually gates.
   * Always false for a normal (sequential, or simultaneous-CENTER) retake,
   * and cleared the moment capture moves past the step it was set for
   * (`advanceToNextStep`), so it can never leak into a later, unrelated step.
   */
  private externalCaptureOnly = false;

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

  public get retakingStepId(): string | null {
    if (this.retakeReturnIdx === null || !this.activeWorkflow) return null;
    return this.activeWorkflow.steps[this.currentStepIdx]?.id ?? null;
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
    this.retakeReturnIdx = null;
    this.externalCaptureOnly = false;
    this.stepStartTime = Date.now();
    this.sensitivity = workflow.sensitivity || this.sensitivity || 'MEDIUM';
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

  private isCapturing = false;
  /**
   * The most recent frame this engine has actually seen, kept independently
   * of the early-return guards below.
   *
   * triggerManualCapture() needs something to gate a MANUAL/OFF-mode capture
   * against even when its caller has no frame handy to pass — see the doc
   * comment there for why that must never mean "skip the check".
   */
  private lastFaceState: FaceState | null = null;

  public async processFrame(faceState: FaceState): Promise<GuidanceState> {
    this.lastFaceState = faceState;

    if (
      this.isCapturing ||
      !this._currentSession ||
      !this.activeWorkflow ||
      this._currentSession.status !== 'RUNNING'
    ) {
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

    // 1. Evaluate Step gates (with sensitivity level)
    const evalResult = this.stepEvaluator.evaluate(
      faceState,
      currentStep,
      this.sensitivity
    );

    // 2. Track Stability (prioritize step duration, then configured autoHoldMs, then a
    // 2000ms floor — the same default every other surface uses: settingsStore,
    // FaceOverlay's countdown ring, OverlayConfigPanel's slider, CaptureTriggerEvaluator.
    // This used to fall back to 500ms, and nothing seeded `autoHoldMs` at engine
    // construction (see FaceCaptureApp.tsx), so every session ran on a 0.5s hold
    // instead of the intended 2s until an operator happened to touch the slider —
    // long enough for the checks to pass for an instant mid-adjustment, not long
    // enough for someone to actually finish posing before the shutter fired.
    const stabilityDuration = currentStep.stability?.durationMs || this.autoHoldMs || 2000;
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

    // 4. Trigger Auto-Capture if in AUTO mode and Stable
    if (this.captureMode === 'AUTO' && stability.isStable && currentStep.capture.enabled) {
      if (this.externalCaptureOnly) {
        // This step's photo must come from the caller's own
        // recordExternalCapture (see `externalCaptureOnly`'s own doc
        // comment) — triggerManualCapture only ever knows how to snapshot
        // this engine's own snapshot provider, the wrong physical camera for
        // a simultaneous-capture side frame. Reset stability so a hold that
        // did not actually land a photo (the caller found no live frame to
        // snapshot) can be retried on the next hold instead of firing this
        // event every processed frame indefinitely.
        this.stabilityTracker.reset();
        this.emit('external-capture-ready', { stepId: currentStep.id });
      } else {
        await this.triggerManualCapture(faceState);
      }
    }

    this.emit('state-change', this._currentState);
    return this._currentState;
  }

  public async triggerManualCapture(faceState?: FaceState | null): Promise<boolean> {
    if (this.isCapturing || !this.activeWorkflow || !this._currentSession) return false;
    // Defence in depth: the real gate is FaceCaptureApp's shutter/gesture
    // handlers routing to recordExternalCapture instead of calling this in
    // the first place (see `externalCaptureOnly`'s own doc comment) — this
    // refusal just means a call site that forgot to check never snapshots
    // the wrong physical camera even if it tries.
    if (this.externalCaptureOnly) return false;
    const currentStep = this.activeWorkflow.steps[this.currentStepIdx];
    if (!currentStep || !currentStep.capture?.enabled) return false;

    // AUTO mode always has a frame to hand (processFrame passes its own), but
    // a MANUAL-gesture or OFF-shutter trigger comes from the UI instead, and
    // used to call this with no faceState at all. That silently skipped the
    // quality re-check below (`policy.quality` ended up null, which
    // CaptureController.validateCapturedImage treats as "nothing to check"),
    // so a smiling capture that a UI-level pre-check missed — or a UI call
    // site that just forgot to pass one — sailed through with no gate behind
    // it whatsoever. Falling back to the last frame this engine actually
    // processed means the gate always has real data, even then.
    const gateFaceState = faceState ?? this.lastFaceState;

    // Re-run the same step-aware evaluation AUTO mode's stability tracking is
    // built on (see processFrame's evalResult), rather than trusting
    // faceState.quality.accepted — the CV engine's *generic*, sensitivity-only
    // reading with no idea what this particular step requires. The two agree
    // today only because no step in this app overrides `quality`; the moment
    // one does, a caller re-deriving its own "is this ok" from the generic
    // reading (as the gesture loop and shutter button do, for their own
    // pre-capture UI state) could disagree with the step's real requirement.
    // Evaluating here, at the point of actually committing the photo, is the
    // one check that can't drift from what the step actually asks for.
    let qualitySnapshot: { accepted: boolean; reasons: string[] } | null = null;
    if (gateFaceState) {
      const stepResult = this.stepEvaluator.evaluate(gateFaceState, currentStep, this.sensitivity);
      qualitySnapshot = { accepted: stepResult.passed, reasons: stepResult.reasons };
    }

    this.isCapturing = true;
    this.stabilityTracker.reset();

    try {
      // 1. Chụp ảnh TRƯỚC KHI nháy flash (Real Base64 Snapshot)
      const captureResult = await this.captureController.captureCurrentFrame();
      const detailedValidation =
        captureResult !== null
          ? await this.captureController.validateCapturedImageDetailed(captureResult.imagePath, {
              quality: qualitySnapshot,
            })
          : null;
      const valid = captureResult !== null && (detailedValidation?.valid ?? false);

      if (valid && captureResult) {
        // advanceToNextStep clears the retake, so the flag is read while it still stands.
        const wasRetake = this.retakeReturnIdx !== null;
        this.updateStepStatus(currentStep.id, 'COMPLETED', captureResult.imagePath, gateFaceState || undefined);

        // Phát sự kiện trigger để UI hiển thị Flash & Freeze Base64 & Animation bay ảnh
        this.emit('capture-trigger', {
          stepId: currentStep.id,
          imagePath: captureResult.imagePath,
        });

        // 2. Chờ thời gian thực hiện animation thu nhỏ và di chuyển về thẻ step (550ms)
        await new Promise((resolve) => setTimeout(resolve, 550));

        // 3. Delay 0.5s (500ms) sau khi xong animation trước khi chuyển sang step mới
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 4. Chính thức chuyển step và reset bộ đếm cho quy trình chụp mới
        await this.advanceToNextStep();

        // Emitted last so listeners see the session already back at its resting state.
        if (wasRetake) {
          this.emit('step-retaken', {
            stepId: currentStep.id,
            imagePath: captureResult.imagePath,
          });
        }
        return true;
      } else {
        const stepResult = this._currentSession.steps.find((s) => s.stepId === currentStep.id);
        if (stepResult) stepResult.attempts++;

        // Diagnostics only — kiosks in the field showed a capture that
        // silently never advanced, with nothing in the logs to say why. This
        // is the first point where "no snapshot" vs. "image validation
        // failed" vs. "quality rejected, and here's which checks" is known,
        // so it's the one place that can report all three distinctly.
        const rejectionPayload = {
          stepId: currentStep.id,
          stepType: currentStep.type,
          reason: captureResult === null ? ('NO_SNAPSHOT' as const) : detailedValidation!.reason,
          qualityReasons: detailedValidation?.qualityReasons,
          captureMode: this.captureMode,
          attempts: stepResult?.attempts ?? 0,
        };
        console.warn('[WorkflowEngine] capture rejected', rejectionPayload);
        this.emit('capture-rejected', rejectionPayload);

        return false;
      }
    } finally {
      this.isCapturing = false;
    }
  }

  public async cancelSession(): Promise<void> {
    if (this._currentSession) {
      this._currentSession.status = 'CANCELLED';
      this._currentSession.completedAt = Date.now();
    }
    this.activeWorkflow = null;
    this.retakeReturnIdx = null;
    this.externalCaptureOnly = false;
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

  /**
   * Re-enter an already visited step so its photo can be replaced.
   *
   * The previous image (`capturedImagePath`) and the position ordered capture
   * had reached both stay put, so abandoning a retake leaves the session
   * exactly as it was, and only a successful capture overwrites the one image
   * being replaced. A session that had already finished is reopened for the
   * duration of the retake and closes itself again as soon as the replacement
   * lands.
   *
   * The retaken step's own `status` is the one thing this resets, back to
   * `PENDING` — a normal (shutter/gesture/AUTO-driven) retake never actually
   * depended on that (`triggerManualCapture`'s success path overwrites status
   * unconditionally, whatever it was), but `recordExternalCapture` — the
   * simultaneous-capture path a side-frame retake uses instead, since it has
   * no shutter/gesture/AUTO trigger of its own to wait on — refuses to touch
   * a step whose status is already `COMPLETED`. Leaving it COMPLETED here
   * silently broke every simultaneous-capture retake: `retakeStep` would
   * report success, but the `recordExternalCapture` call right after it
   * (FaceCaptureApp.tsx's `handleRetakeStep`) would be rejected and the old
   * photo would never actually be replaced, with nothing surfacing the
   * failure (that call site does not check `recordExternalCapture`'s return
   * value, since a normal CENTER retake never needed to).
   *
   * `options.externalCapture` (§ desktop kiosk multi-camera capture, product
   * decision 2026-09-05 #3): set for a simultaneous-capture side frame,
   * whose photo comes from its own physical camera rather than the one this
   * engine's snapshot provider reads — see `externalCaptureOnly`'s own doc
   * comment for what it gates. Omitted/false (every existing call site)
   * leaves this exactly as it always was.
   */
  public async retakeStep(stepId: string, options?: { externalCapture?: boolean }): Promise<boolean> {
    // A cancelled session has no active workflow, so it is turned away here too.
    if (this.isCapturing || !this.activeWorkflow || !this._currentSession) return false;

    const idx = this.activeWorkflow.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return false;

    const step = this.activeWorkflow.steps[idx];
    // Retaking during a retake must still come back to where ordered capture
    // was interrupted, not to the step of the retake that preceded it.
    if (this.retakeReturnIdx === null) this.retakeReturnIdx = this.currentStepIdx;
    this.currentStepIdx = idx;
    this.stepStartTime = Date.now();
    this.stabilityTracker.reset();
    this.externalCaptureOnly = !!options?.externalCapture;

    this._currentSession.status = 'RUNNING';
    this._currentSession.completedAt = undefined;

    const stepResult = this._currentSession.steps.find((s) => s.stepId === stepId);
    if (stepResult) {
      // See this method's own doc comment for why: unblocks a subsequent
      // recordExternalCapture() for this same step. capturedImagePath is
      // deliberately left alone — the old photo stays visible until the
      // replacement actually lands.
      stepResult.status = 'PENDING';
      // Counted before the shot is taken, so the replacement is stored under
      // an attempt of its own instead of colliding with the photo it replaces.
      stepResult.attempts++;
    }

    this._currentState = {
      status: 'POSITIONING',
      primaryInstruction: step.instruction,
      primaryReason: 'NO_FACE',
      progress: 0,
      hints: [],
      currentStepIndex: idx,
      totalSteps: this.activeWorkflow.steps.length,
      stepId: step.id,
      stepType: step.type,
    };

    this.emit('state-change', this._currentState);
    return true;
  }

  /**
   * Post-save "chụp lại toàn bộ" (2026-09-08 feature): resets every step
   * back to PENDING and rewinds to the first one, the same shape a fresh
   * `startSession()` would leave things in — except `_currentSession.id`
   * (and everything else about the session/workflow) is left untouched.
   * Mirrors `retakeStep()`'s own body almost exactly, applied to every step
   * instead of one; see that method's own doc comment for the shared guard
   * conditions and for why `capturedImagePath` is left alone until each
   * step's replacement actually lands.
   *
   * `retakeReturnIdx` stays `null` rather than pointing anywhere — unlike a
   * single-step retake (which must come back to wherever ordered capture
   * was interrupted), a full retake has no later point to return to: every
   * step is being redone from the start, in the original order.
   *
   * Exists specifically for retaking a session that was already reviewed
   * and approved once (`FaceCaptureApp.tsx`'s `handlePostSaveRetakeAll`) —
   * `handleRestart`'s pre-approval "chụp lại toàn bộ" keeps using
   * `startSession()` unchanged (a fresh session id there is correct and
   * unrelated to this method).
   */
  public retakeAllSteps(): boolean {
    if (this.isCapturing || !this.activeWorkflow || !this._currentSession) return false;

    this.currentStepIdx = 0;
    this.retakeReturnIdx = null;
    this.stepStartTime = Date.now();
    this.stabilityTracker.reset();
    this.externalCaptureOnly = false;

    this._currentSession.status = 'RUNNING';
    this._currentSession.completedAt = undefined;
    for (const stepResult of this._currentSession.steps) {
      stepResult.status = 'PENDING';
      stepResult.attempts++;
    }

    const firstStep = this.activeWorkflow.steps[0];
    this._currentState = {
      status: 'POSITIONING',
      primaryInstruction: firstStep.instruction,
      primaryReason: 'NO_FACE',
      progress: 0,
      hints: [],
      currentStepIndex: 0,
      totalSteps: this.activeWorkflow.steps.length,
      stepId: firstStep.id,
      stepType: firstStep.type,
    };

    this.emit('state-change', this._currentState);
    return true;
  }

  /**
   * Hands the engine a photo captured by another physical camera for
   * `stepId` — the "simultaneous capture" flow, where one shutter press
   * fires every frame's own camera at once and the UI routes each resulting
   * image straight to its step, with no pose/quality gate (the subject looks
   * straight ahead; the angle comes from which camera fired, not from
   * posing). Marks the step COMPLETED through the same `updateStepStatus`
   * bookkeeping a normal capture uses and emits the same `capture-trigger`
   * payload, so `packages/ui`'s existing `storePhoto` handler and the
   * review/retake UI need no special case for where the photo came from.
   *
   * Returns false — and changes nothing — if there is no active session,
   * `stepId` isn't part of the current workflow, or that step is already
   * COMPLETED. Never throws.
   */
  public recordExternalCapture(stepId: string, imagePath: string): boolean {
    if (
      !this.activeWorkflow ||
      !this._currentSession ||
      this._currentSession.status !== 'RUNNING'
    ) {
      return false;
    }

    const stepIdx = this.activeWorkflow.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return false;

    const stepResult = this._currentSession.steps.find((s) => s.stepId === stepId);
    if (!stepResult || stepResult.status === 'COMPLETED') return false;

    // Counted before the bookkeeping below, the same way a retake counts its
    // replacement shot: this call *is* the attempt.
    stepResult.attempts++;
    this.updateStepStatus(stepId, 'COMPLETED', imagePath);

    this.emit('capture-trigger', { stepId, imagePath });

    // Only the step ordered capture is actually waiting on moves the
    // cursor; a future step just sits COMPLETED until advanceToNextStep's
    // already-completed skip carries the current index past it later.
    if (stepIdx === this.currentStepIdx) {
      void this.advanceToNextStep();
    }

    return true;
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

    // The retake this flag (if any) was set for has just been completed —
    // whatever step capture moves to next defaults back to this engine's own
    // capture path unless a later retakeStep() call says otherwise. Without
    // this, a simultaneous-capture side-frame retake's flag would otherwise
    // stay stuck true and silently suppress a completely unrelated later
    // step's normal AUTO/triggerManualCapture path.
    this.externalCaptureOnly = false;

    // A retake re-entered a step the workflow had already passed, so ordered
    // capture picks up at the step it interrupted, not after the retaken one.
    let nextIdx = this.retakeReturnIdx !== null ? this.retakeReturnIdx : this.currentStepIdx + 1;
    this.retakeReturnIdx = null;

    // recordExternalCapture can mark a step COMPLETED out of order (one
    // shutter press feeding every physical camera at once), so ordered
    // capture must skip past whatever is already done instead of re-asking
    // for a photo it already has.
    const steps = this.activeWorkflow.steps;
    const session = this._currentSession;
    while (
      nextIdx < steps.length &&
      session.steps.find((s) => s.stepId === steps[nextIdx].id)?.status === 'COMPLETED'
    ) {
      nextIdx++;
    }
    this.currentStepIdx = nextIdx;

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

  public setSensitivity(sensitivity: CaptureSensitivity): void {
    this.sensitivity = sensitivity;
  }

  public getSensitivity(): CaptureSensitivity {
    return this.sensitivity;
  }

  public setCaptureTriggerConfig(config: { mode?: CaptureTriggerMode; autoHoldMs?: number }): void {
    if (config.mode !== undefined) this.captureMode = config.mode;
    if (config.autoHoldMs !== undefined) this.autoHoldMs = config.autoHoldMs;
  }

  public setSnapshotProvider(provider: () => string | null): void {
    this.captureController.setSnapshotProvider(provider);
  }
}
