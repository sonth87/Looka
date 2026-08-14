import { FaceLandmark, FacePose } from '@face/core';

/**
 * Sign convention — stated here because "left" is ambiguous and getting it wrong
 * is silent: the system keeps working, but every captured frame carries the
 * wrong pose label, and it only surfaces much later as unexplained recognition
 * failures.
 *
 * Angles describe the SUBJECT's own motion, not the direction things move in
 * the image:
 *
 *   yaw  < 0  subject turns to THEIR left   (their face points to image-right, nose.x rises)
 *   yaw  > 0  subject turns to THEIR right  (their face points to image-left,  nose.x falls)
 *   pitch > 0 subject looks up
 *   pitch < 0 subject looks down
 *   roll > 0  subject's head tilts so their right ear approaches their shoulder
 *
 * This matches the workflow step targets: LEFT_15 = yaw -15, RIGHT_15 = yaw +15.
 *
 * The camera image is assumed NOT mirrored. Kiosk previews are usually mirrored
 * for the user's comfort; if landmarks are produced from a mirrored frame, set
 * `mirrored: true` so yaw and roll are flipped back into subject space rather
 * than every caller having to remember to negate them.
 */
export interface PoseEstimatorOptions {
  /** EMA factor: 0.05 = heavy smoothing, 1.0 = none. Default 0.3. */
  alpha?: number;
  /** True when landmarks come from a horizontally mirrored frame. Default false. */
  mirrored?: boolean;
  /**
   * Frame width divided by height.
   *
   * Landmarks are normalised per axis, so x and y are only comparable once x is
   * scaled by this. Defaults to 1 — correct only for a square frame, and the
   * reason roll used to read far larger than the head was actually tilted.
   */
  aspect?: number;
}

/** Landmark indices used, in image space (x rises to the right of the image). */
const IDX = {
  nose: 1,
  eyeImageLeft: 33,
  eyeImageRight: 263,
  cheekImageLeft: 234,
  cheekImageRight: 454,
  chin: 152,
} as const;

/**
 * Nose-tip drop below the eye line at neutral pitch, in eye-span units.
 *
 * Landmarks 33 and 263 are the outer eye corners, about 90 mm apart on an adult
 * face; the nose tip sits roughly 48 mm below the line joining them.
 */
const NEUTRAL_NOSE_SPAN = 48 / 90;

/** Degrees per unit of normalised asymmetry. Heuristic — calibrate on real hardware. */
const YAW_GAIN = 90;

/**
 * Degrees per unit of nose-drop change.
 *
 * The pitch signal comes from the nose protruding about 20 mm in front of the
 * face plane: rotating the head swings that offset through the image. Near
 * neutral the projected drop changes by ~20 mm per radian, which over a 90 mm
 * eye span is 0.0039 span-units per degree — so a degree costs 1/0.0039.
 *
 * Derived from average anatomy, not measured on this hardware. One capture at a
 * known angle is enough to replace it with a real figure.
 */
const PITCH_GAIN = 90 / 20 / (Math.PI / 180);

export class PoseEstimator {
  private lastPose: FacePose | null = null;
  private alpha: number;
  private mirrored: boolean;
  private aspect: number;

  constructor(options: number | PoseEstimatorOptions = {}) {
    const opts: PoseEstimatorOptions = typeof options === 'number' ? { alpha: options } : options;
    this.alpha = Math.max(0.05, Math.min(1.0, opts.alpha ?? 0.3));
    this.mirrored = opts.mirrored ?? false;
    this.aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
  }

  /**
   * Tell the estimator the shape of the frames it is reading.
   *
   * Called once the camera reports its real resolution, which is not known when
   * the engine is constructed.
   */
  public setFrameSize(width: number, height: number): void {
    if (width > 0 && height > 0) this.aspect = width / height;
  }

  public reset(): void {
    this.lastPose = null;
  }

  /**
   * Estimate head pose from normalised landmarks.
   *
   * A 2D heuristic, not a solved 3D pose: it reads facial asymmetry, so the
   * gains are approximate and must be calibrated against known angles on the
   * target camera before the numbers are trusted as degrees.
   */
  public estimateRawPose(landmarks: FaceLandmark[]): FacePose {
    if (!landmarks || landmarks.length < 33) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const nose = landmarks[IDX.nose] || { x: 0.5, y: 0.5, z: 0 };
    const eyeL = landmarks[IDX.eyeImageLeft] || { x: 0.3, y: 0.4, z: 0 };
    const eyeR = landmarks[IDX.eyeImageRight] || { x: 0.7, y: 0.4, z: 0 };
    const cheekL = landmarks[IDX.cheekImageLeft] || { x: 0.2, y: 0.5, z: 0 };
    const cheekR = landmarks[IDX.cheekImageRight] || { x: 0.8, y: 0.5, z: 0 };

    // --- Roll: tilt of the eye line ---
    // Landmark x is normalised by frame width and y by frame height, so on a
    // 16:9 frame one unit of x spans 1.78x the pixels of one unit of y. Feeding
    // those straight to atan2 stretches every angle — a real 15 degree tilt
    // reported as 25 — so x is scaled back into the same units as y first.
    const roll =
      Math.atan2(eyeR.y - eyeL.y, (eyeR.x - eyeL.x) * this.aspect) * (180 / Math.PI);

    // --- Yaw: where the nose sits between the two face edges ---
    // Turning towards their own left pushes the nose towards image-right, so the
    // gap to the right cheek shrinks. Negated to land in subject space.
    //
    // Horizontal distance only. Using the full 2D distance let vertical motion
    // leak in: a tilted or raised head changed the nose-to-cheek offsets in y
    // and moved the yaw reading with it, reporting a turn that never happened.
    // The width normalisation cancels in the ratio, so no aspect term is needed.
    const distL = Math.abs(nose.x - cheekL.x);
    const distR = Math.abs(cheekR.x - nose.x);
    const spread = distL + distR;
    const yaw = spread > 0 ? -((distL - distR) / spread) * YAW_GAIN : 0;

    // --- Pitch: how far the nose sits below the eye line, in eye-span units ---
    // Looking up foreshortens the lower face and lifts the projected nose towards
    // the eye line, so the ratio falls. Subtracting from neutral keeps up positive.
    //
    // Measured against the distance between the eyes, not the eye-to-chin height.
    // Eye-to-chin foreshortens with the very angle being measured: looking down
    // tucks the chin towards the eye line, so the denominator collapsed exactly
    // as the pose approached the target, amplifying landmark noise until the
    // reading could no longer settle — the step became impossible to hold rather
    // than merely hard. The eye line is horizontal, so pitch does not shorten it,
    // and it scales with the face, which keeps the measure independent of how
    // close the subject stands.
    const eyeMidY = (eyeL.y + eyeR.y) / 2;
    // x is normalised by frame width and y by height, so the horizontal span has
    // to be converted before it can be compared with a vertical drop.
    const eyeSpan = Math.abs(eyeR.x - eyeL.x) * this.aspect;
    const pitch =
      eyeSpan > 1e-6
        ? (NEUTRAL_NOSE_SPAN - (nose.y - eyeMidY) / eyeSpan) * PITCH_GAIN
        : 0;

    // Mirrored frames invert horizontal motion; yaw and roll flip, pitch does not.
    const flip = this.mirrored ? -1 : 1;

    return {
      yaw: clampDeg(yaw * flip),
      pitch: clampDeg(pitch),
      roll: clampDeg(roll * flip),
    };
  }

  /** Estimate pose and apply EMA smoothing to suppress frame-to-frame jitter. */
  public estimatePose(landmarks: FaceLandmark[]): FacePose {
    return this.smooth(this.estimateRawPose(landmarks));
  }

  /**
   * Apply the same EMA to a pose obtained elsewhere.
   *
   * A solved 3D pose still jitters frame to frame, and it shares the smoothing
   * history with the 2D estimate so switching between them mid-session does not
   * make the reading jump.
   */
  public smooth(raw: FacePose): FacePose {
    if (!this.lastPose) {
      this.lastPose = raw;
      return raw;
    }

    const blend = (next: number, prev: number) =>
      Number((this.alpha * next + (1 - this.alpha) * prev).toFixed(1));

    const smoothed: FacePose = {
      yaw: blend(raw.yaw, this.lastPose.yaw),
      pitch: blend(raw.pitch, this.lastPose.pitch),
      roll: blend(raw.roll, this.lastPose.roll),
    };

    this.lastPose = smoothed;
    return smoothed;
  }
}

function clampDeg(value: number): number {
  return Number(Math.max(-90, Math.min(90, value)).toFixed(1));
}
