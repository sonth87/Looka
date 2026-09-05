import {
  CaptureStep,
  CaptureSensitivity,
  FaceState,
  StepEvaluationResult,
  StepEvaluator as IStepEvaluator,
  defaultCameraRoleForStepType,
} from '@face/core';
import { MAX_FRONT_SMILE_SCORE, QualityEvaluator } from '@face/face-quality';

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
        postureValid: false,
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

    // §2.8's absolute resolution floor (FACE_RESOLUTION_TOO_LOW) is a proxy
    // for whether the FRONT/CENTER capture — the printed/matched photo —
    // resolved enough real pixels. Product decision (2026-09-05): "Chỉ cần
    // cam chính diện >= 250px là được, các cam khác không cần" — LEFT/RIGHT/
    // UP/DOWN steps are process evidence, not the printed photo, and must not
    // be blocked by a side camera's lower resolution. Resolved via the same
    // role a step actually captures on (explicit `cameraRole`, else the
    // type's default — see `defaultCameraRoleForStepType`), not `step.type`
    // directly, so a CUSTOM step mapped onto CENTER still gets the floor.
    const cameraRole = step.cameraRole ?? defaultCameraRoleForStepType(step.type);
    const enforceFaceResolution = cameraRole === 'CENTER';

    // Product decision (2026-09-05, field report "cười vẫn cho chụp"): an ID
    // photo must be neutral, so the FRONT/CENTER step's smile ceiling is
    // capped at MAX_FRONT_SMILE_SCORE (0.30) regardless of sensitivity level
    // — a moderate smile was passing under LOW/MEDIUM's own, looser ceiling.
    // Same role resolution as `enforceFaceResolution` above: side-angle
    // steps are process evidence, not the printed/matched photo, and keep
    // the level's own ceiling (omit the override rather than pass Infinity,
    // so evaluateQuality's "never loosens" contract stays honest).
    const maxSmileScoreOverride = cameraRole === 'CENTER' ? MAX_FRONT_SMILE_SCORE : undefined;

    // No pixels (or blendshapes) reach this far — only a FaceState — but the
    // CV engine already measured all four from the same frame. Passing them
    // through lets the step apply its own thresholds to real figures; without
    // them the gate skipped every check entirely, so BLURRY, TOO_DARK,
    // EYES_CLOSED and SMILING could never block a capture no matter how bad
    // the frame was.
    const qualityResult = this.qualityEvaluator.evaluateQuality(
      faceState.detection.boundingBox,
      frameWidth,
      frameHeight,
      undefined,
      qualityReq,
      {
        brightness: faceState.quality?.brightness ?? null,
        sharpness: faceState.quality?.sharpness ?? null,
        eyeOpenScore: faceState.quality?.eyeOpenScore ?? null,
        smileScore: faceState.quality?.smileScore ?? null,
      },
      // §2.8's absolute resolution floor must be measured against the
      // resolution the capture will actually be SAVED at, not `frameWidth`/
      // `frameHeight` above (the CV analysis frame, which may be downscaled
      // — see FrameInput.nativeWidth's doc comment). Falls back to the
      // analysis frame itself when the CV engine reports no native
      // resolution (e.g. simulation mode), same as evaluateQuality's own
      // default.
      faceState.captureFrameWidth && faceState.captureFrameHeight
        ? { width: faceState.captureFrameWidth, height: faceState.captureFrameHeight }
        : undefined,
      { enforceFaceResolution, maxSmileScoreOverride }
    );

    const qualityValid = qualityResult.accepted;
    const sizeValid =
      !qualityResult.reasons.includes('FACE_TOO_SMALL') &&
      !qualityResult.reasons.includes('FACE_TOO_LARGE') &&
      !qualityResult.reasons.includes('FACE_RESOLUTION_TOO_LOW');
    const positionValid = !qualityResult.reasons.includes('OFF_CENTER');

    if (!qualityValid) {
      reasons.push(...qualityResult.reasons);
    }

    // 4. Posture check (shoulder level, from the body-pose model) — only for
    // steps where it's meaningful. Turning the head for LEFT/RIGHT legitimately
    // rotates the shoulder line and can take a shoulder out of frame; neither
    // is a posture defect, so those steps opt out via step.postureCheck.
    const postureCheckEnabled = step.postureCheck !== false;
    const postureValid =
      !postureCheckEnabled || !faceState.posture || faceState.posture.reasons.length === 0;
    if (postureCheckEnabled && !postureValid && faceState.posture) {
      reasons.push(...faceState.posture.reasons);
    }

    const passed = presenceValid && poseValid && qualityValid && postureValid;

    return {
      passed,
      presenceValid,
      poseValid,
      qualityValid,
      positionValid,
      sizeValid,
      postureValid,
      reasons: Array.from(new Set(reasons)),
    };
  }
}
