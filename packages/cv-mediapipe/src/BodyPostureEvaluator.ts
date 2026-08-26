import { BodyPostureResult } from '@face/core';

/**
 * Landmark indices from MediaPipe PoseLandmarker's 33-point body model.
 * Shoulders only — nothing else needed to answer "is this person square to
 * the camera", and every extra landmark asked for is another point that can
 * fail to detect.
 *
 * These are the subject's own (anatomical) shoulders, not image-space sides —
 * see the image-space swap below, which follows the same convention
 * PoseEstimator.ts uses for eyeImageLeft/eyeImageRight.
 */
const IDX = { anatomicalLeftShoulder: 11, anatomicalRightShoulder: 12 } as const;

/**
 * Below this, PoseLandmarker's own visibility score means "probably not
 * really there" rather than "there but partially occluded" — trusting a
 * shoulder position under that floor would compute a tilt angle from a
 * guess, not a measurement.
 */
const MIN_SHOULDER_VISIBILITY = 0.5;

/**
 * Heuristic starting point, not calibrated on the deployed kiosk — same
 * status as YAW_GAIN/PITCH_GAIN in PoseEstimator.ts. A person's shoulders
 * are rarely perfectly level even standing normally, so this has to be wide
 * enough to accept ordinary posture while still catching someone leaning to
 * one side or turned at an angle to the camera.
 */
const MAX_SHOULDER_TILT_DEG = 15;

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * Shoulder-level check from body-pose landmarks.
 *
 * Same roll formula as PoseEstimator's head roll, applied to the shoulder
 * line instead of the eye line: x is normalised by frame width and y by
 * height, so x has to be scaled by `aspect` before comparing it against y or
 * a 16:9 frame stretches every angle.
 */
export function evaluatePosture(
  landmarks: PoseLandmark[] | null | undefined,
  aspect: number
): BodyPostureResult {
  const reasons: string[] = [];

  if (!landmarks || landmarks.length <= IDX.anatomicalRightShoulder) {
    return { shoulderRoll: null, shouldersVisible: null, leveled: null, reasons };
  }

  const anatomicalLeft = landmarks[IDX.anatomicalLeftShoulder];
  const anatomicalRight = landmarks[IDX.anatomicalRightShoulder];
  const shouldersVisible =
    (anatomicalLeft?.visibility ?? 0) >= MIN_SHOULDER_VISIBILITY &&
    (anatomicalRight?.visibility ?? 0) >= MIN_SHOULDER_VISIBILITY;

  if (!shouldersVisible) {
    reasons.push('SHOULDERS_NOT_VISIBLE');
    return { shoulderRoll: null, shouldersVisible: false, leveled: null, reasons };
  }

  // Facing an unmirrored camera, the subject's anatomical LEFT shoulder falls
  // on the image's RIGHT side (larger x) and vice versa — the same mirroring
  // PoseEstimator's face landmarks go through (see its eyeImageLeft/
  // eyeImageRight comment). Swapping here before the atan2 keeps this an
  // image-left-to-image-right vector, which is what the formula assumes;
  // feeding it the anatomical pair directly made a level pair of shoulders
  // read as ~180 degrees instead of ~0, since anatomicalRight.x - anatomicalLeft.x
  // is negative for a person square to the camera.
  const imageLeft = anatomicalRight;
  const imageRight = anatomicalLeft;

  const roll = Math.atan2(imageRight.y - imageLeft.y, (imageRight.x - imageLeft.x) * aspect) * (180 / Math.PI);
  const leveled = Math.abs(roll) <= MAX_SHOULDER_TILT_DEG;
  if (!leveled) reasons.push('SHOULDERS_TILTED');

  return {
    shoulderRoll: Number(roll.toFixed(1)),
    shouldersVisible: true,
    leveled,
    reasons,
  };
}
