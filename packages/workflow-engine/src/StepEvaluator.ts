import {
  CaptureStep,
  CaptureSensitivity,
  FaceState,
  StepEvaluationResult,
  StepEvaluator as IStepEvaluator,
} from '@face/core';
import { QualityEvaluator } from '@face/face-quality';

const POSE_TOLERANCE_MULTIPLIERS: Record<CaptureSensitivity, number> = {
  VERY_LOW: 1.5,
  LOW: 1.25,
  MEDIUM: 1.0,
  HIGH: 0.8,
  VERY_HIGH: 0.5,
};

export class StepEvaluator implements IStepEvaluator {
  private qualityEvaluator = new QualityEvaluator();

  public evaluate(
    faceState: FaceState,
    step: CaptureStep,
    workflowSensitivity: CaptureSensitivity = 'MEDIUM'
  ): StepEvaluationResult {
    const sensitivity = step.sensitivity || workflowSensitivity || 'MEDIUM';
    const toleranceMultiplier = POSE_TOLERANCE_MULTIPLIERS[sensitivity] || 1.0;
    const reasons: string[] = [];

    // 1. Presence check
    const presenceValid = faceState.detected && faceState.faceCount === 1;
    if (!faceState.detected || faceState.faceCount === 0) {
      reasons.push('NO_FACE');
    } else if (faceState.faceCount > 1) {
      reasons.push('MULTIPLE_FACES');
    }

    if (!presenceValid || !faceState.detection) {
      return {
        passed: false,
        presenceValid: false,
        poseValid: false,
        qualityValid: false,
        positionValid: false,
        sizeValid: false,
        reasons,
      };
    }

    // 2. Pose check (scaled by sensitivity tolerance multiplier)
    let poseValid = true;
    if (step.pose && faceState.pose) {
      const { yaw, pitch, roll } = faceState.pose;

      if (step.pose.yaw) {
        const effectiveTolerance = step.pose.yaw.tolerance * toleranceMultiplier;
        const diff = Math.abs(yaw - step.pose.yaw.target);
        if (diff > effectiveTolerance) {
          poseValid = false;
          reasons.push(yaw < step.pose.yaw.target ? 'TURN_RIGHT' : 'TURN_LEFT');
        }
      }

      if (step.pose.pitch) {
        const effectiveTolerance = step.pose.pitch.tolerance * toleranceMultiplier;
        const diff = Math.abs(pitch - step.pose.pitch.target);
        if (diff > effectiveTolerance) {
          poseValid = false;
          reasons.push(pitch < step.pose.pitch.target ? 'LOOK_UP' : 'LOOK_DOWN');
        }
      }

      if (step.pose.roll) {
        const effectiveTolerance = step.pose.roll.tolerance * toleranceMultiplier;
        const diff = Math.abs(roll - step.pose.roll.target);
        if (diff > effectiveTolerance) {
          poseValid = false;
          reasons.push('TILT_CORRECT');
        }
      }
    }

    // 3. Quality check (dynamic frame dimensions from camera stream)
    const frameWidth = faceState.frameWidth || 640;
    const frameHeight = faceState.frameHeight || 480;
    const qualityReq = {
      sensitivity,
      ...step.quality,
    };

    // No pixels reach this far — only a FaceState — but the CV engine already
    // measured brightness and sharpness from the same frame. Passing those
    // through lets the step apply its own thresholds to real figures; without
    // them the gate skipped both checks entirely, so BLURRY and TOO_DARK could
    // never block a capture no matter how bad the frame was.
    const qualityResult = this.qualityEvaluator.evaluateQuality(
      faceState.detection.boundingBox,
      frameWidth,
      frameHeight,
      undefined,
      qualityReq,
      {
        brightness: faceState.quality?.brightness ?? null,
        sharpness: faceState.quality?.sharpness ?? null,
      }
    );

    const qualityValid = qualityResult.accepted;
    const sizeValid =
      !qualityResult.reasons.includes('FACE_TOO_SMALL') &&
      !qualityResult.reasons.includes('FACE_TOO_LARGE');
    const positionValid = !qualityResult.reasons.includes('OFF_CENTER');

    if (!qualityValid) {
      reasons.push(...qualityResult.reasons);
    }

    const passed = presenceValid && poseValid && qualityValid;

    return {
      passed,
      presenceValid,
      poseValid,
      qualityValid,
      positionValid,
      sizeValid,
      reasons: Array.from(new Set(reasons)),
    };
  }
}
