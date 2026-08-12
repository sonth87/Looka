import {
  CaptureStep,
  FaceState,
  StepEvaluationResult,
  StepEvaluator as IStepEvaluator,
} from '@face/core';
import { QualityEvaluator } from '@face/face-quality';

export class StepEvaluator implements IStepEvaluator {
  private qualityEvaluator = new QualityEvaluator();

  public evaluate(faceState: FaceState, step: CaptureStep): StepEvaluationResult {
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

    // 2. Pose check
    let poseValid = true;
    if (step.pose && faceState.pose) {
      const { yaw, pitch, roll } = faceState.pose;

      if (step.pose.yaw) {
        const diff = Math.abs(yaw - step.pose.yaw.target);
        if (diff > step.pose.yaw.tolerance) {
          poseValid = false;
          reasons.push(yaw < step.pose.yaw.target ? 'TURN_RIGHT' : 'TURN_LEFT');
        }
      }

      if (step.pose.pitch) {
        const diff = Math.abs(pitch - step.pose.pitch.target);
        if (diff > step.pose.pitch.tolerance) {
          poseValid = false;
          reasons.push(pitch < step.pose.pitch.target ? 'LOOK_UP' : 'LOOK_DOWN');
        }
      }

      if (step.pose.roll) {
        const diff = Math.abs(roll - step.pose.roll.target);
        if (diff > step.pose.roll.tolerance) {
          poseValid = false;
          reasons.push('TILT_CORRECT');
        }
      }
    }

    // 3. Quality check
    const frameWidth = 640; // Default reference frame width
    const frameHeight = 480;
    const qualityResult = this.qualityEvaluator.evaluateQuality(
      faceState.detection.boundingBox,
      frameWidth,
      frameHeight,
      undefined,
      step.quality
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
      reasons: Array.from(new Set(reasons)), // Deduplicate reasons
    };
  }
}
