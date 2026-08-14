import {
  CaptureStep,
  FaceState,
  GuidanceHint,
  GuidancePriorityReason,
  GuidanceState,
  GuidanceStatus,
  GuidanceEngine as IGuidanceEngine,
  StepEvaluationResult,
} from '@face/core';

export class GuidanceEngine implements IGuidanceEngine {
  private lastReason: GuidancePriorityReason | null = null;
  private reasonHoldCount = 0;
  private readonly HYSTERESIS_THRESHOLD = 2; // Frames to hold before switching reasons

  private readonly MESSAGES: Record<GuidancePriorityReason, string> = {
    NO_FACE: 'Hãy nhìn vào camera',
    MULTIPLE_FACES: 'Vui lòng chỉ để 1 người trong khung hình',
    FACE_TOO_SMALL: 'Hãy đưa mặt lại gần camera hơn',
    FACE_TOO_LARGE: 'Hãy lùi xa camera một chút',
    OFF_CENTER: 'Hãy di chuyển mặt vào giữa khung hình',
    TURN_LEFT: 'Quay mặt sang trái',
    TURN_RIGHT: 'Quay mặt sang phải',
    LOOK_UP: 'Ngẩng mặt lên một chút',
    LOOK_DOWN: 'Cúi mặt xuống một chút',
    TILT_CORRECT: 'Giữ thẳng đầu',
    TOO_DARK: 'Hãy di chuyển tới nơi sáng hơn',
    TOO_BRIGHT: 'Tránh nguồn sáng quá mạnh chiếu vào mặt',
    // Movement is only one cause. A dim room makes the camera hold the shutter
    // open longer, which blurs a subject who is standing perfectly still, so
    // telling them to keep still sends them chasing the wrong thing.
    BLURRY: 'Ảnh chưa nét — giữ yên đầu và tìm chỗ sáng hơn',
    OCCLUDED: 'Vui lòng bỏ khẩu trang hoặc vật che mặt',
    HOLD_STILL: 'Giữ nguyên tư thế...',
    READY: 'Tư thế đúng! Giữ nguyên...',
  };

  public evaluateGuidance(
    faceState: FaceState,
    step: CaptureStep,
    evaluation: StepEvaluationResult,
    statusOverride?: GuidanceStatus,
    progressOverride?: number
  ): GuidanceState {
    const primaryReason = this.selectPriorityReason(evaluation);

    // Apply hysteresis to prevent rapid instruction flickering
    const stableReason = this.applyHysteresis(primaryReason);
    const instruction = step.instruction || this.MESSAGES[stableReason];

    let status: GuidanceStatus = statusOverride || 'ADJUSTING';
    if (!statusOverride) {
      if (!faceState.detected || faceState.faceCount === 0) {
        status = 'SEARCHING_FACE';
      } else if (faceState.faceCount > 1) {
        status = 'MULTIPLE_FACES';
      } else if (!evaluation.positionValid || !evaluation.sizeValid) {
        status = 'POSITIONING';
      } else if (evaluation.passed) {
        status = 'READY';
      }
    }

    const hints: GuidanceHint[] = evaluation.reasons.map((r) => ({
      code: r as GuidancePriorityReason,
      message: this.MESSAGES[r as GuidancePriorityReason] || r,
    }));

    return {
      status,
      primaryInstruction: instruction,
      primaryReason: stableReason,
      progress: progressOverride ?? (evaluation.passed ? 1.0 : 0.5),
      hints,
      currentStepIndex: 0,
      totalSteps: 1,
      stepId: step.id,
      stepType: step.type,
    };
  }

  private selectPriorityReason(evaluation: StepEvaluationResult): GuidancePriorityReason {
    const priorityOrder: GuidancePriorityReason[] = [
      'NO_FACE',
      'MULTIPLE_FACES',
      'FACE_TOO_SMALL',
      'FACE_TOO_LARGE',
      'OFF_CENTER',
      'TURN_LEFT',
      'TURN_RIGHT',
      'LOOK_UP',
      'LOOK_DOWN',
      'TILT_CORRECT',
      'TOO_DARK',
      'TOO_BRIGHT',
      'BLURRY',
      'OCCLUDED',
    ];

    for (const reason of priorityOrder) {
      if (evaluation.reasons.includes(reason)) {
        return reason;
      }
    }

    return evaluation.passed ? 'READY' : 'HOLD_STILL';
  }

  private applyHysteresis(reason: GuidancePriorityReason): GuidancePriorityReason {
    if (!this.lastReason) {
      this.lastReason = reason;
      this.reasonHoldCount = 0;
      return reason;
    }

    if (reason !== this.lastReason) {
      this.reasonHoldCount++;
      if (this.reasonHoldCount >= this.HYSTERESIS_THRESHOLD) {
        this.lastReason = reason;
        this.reasonHoldCount = 0;
      }
    } else {
      this.reasonHoldCount = 0;
    }

    return this.lastReason;
  }
}
