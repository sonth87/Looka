import { FaceLandmark, FacePose } from '@face/core';

export class PoseEstimator {
  private lastPose: FacePose | null = null;
  private alpha: number;

  /**
   * @param alpha Smoothing factor for EMA (0.1 = heavy smoothing, 1.0 = no smoothing). Default: 0.3
   */
  constructor(alpha = 0.3) {
    this.alpha = Math.max(0.05, Math.min(1.0, alpha));
  }

  public reset(): void {
    this.lastPose = null;
  }

  /**
   * Estimates raw head pose (Yaw, Pitch, Roll) from normalized facial landmarks.
   */
  public estimateRawPose(landmarks: FaceLandmark[]): FacePose {
    if (!landmarks || landmarks.length < 33) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const nose = landmarks[1] || { x: 0.5, y: 0.5, z: 0 };
    const leftEye = landmarks[33] || { x: 0.3, y: 0.4, z: 0 };
    const rightEye = landmarks[263] || { x: 0.7, y: 0.4, z: 0 };
    const leftCheek = landmarks[234] || { x: 0.2, y: 0.5, z: 0 };
    const rightCheek = landmarks[454] || { x: 0.8, y: 0.5, z: 0 };
    const chin = landmarks[152] || { x: 0.5, y: 0.8, z: 0 };

    // --- Roll calculation ---
    // Angle of line connecting left & right eye with horizontal axis
    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    const rollRadians = Math.atan2(dy, dx);
    let roll = rollRadians * (180 / Math.PI);

    // --- Yaw calculation ---
    // Symmetry ratio of nose relative to left and right face edges (cheeks)
    const distLeft = Math.hypot(nose.x - leftCheek.x, nose.y - leftCheek.y);
    const distRight = Math.hypot(rightCheek.x - nose.x, rightCheek.y - nose.y);
    const totalDist = distLeft + distRight;

    let yaw = 0;
    if (totalDist > 0) {
      // Invert ratio sign: Turning physical LEFT -> nose moves towards right cheek in frame (distRight < distLeft)
      // Standard pose convention: Turn Left = Negative Yaw (-), Turn Right = Positive Yaw (+)
      const ratio = (distLeft - distRight) / totalDist;
      yaw = -ratio * 90; // Scale to degrees (-90 to +90 deg)
    }

    // --- Pitch calculation ---
    // Vertical position of nose relative to eye-midpoint and chin
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const faceHeight = Math.abs(chin.y - eyeMidY);

    let pitch = 0;
    if (faceHeight > 0) {
      const noseDistFromMid = nose.y - eyeMidY;
      const expectedRatio = 0.4; // Neutral face nose position ratio
      const actualRatio = noseDistFromMid / faceHeight;
      pitch = (actualRatio - expectedRatio) * 120; // Positive = up, Negative = down
    }

    // Clamp values to -90..+90
    return {
      yaw: Number(Math.max(-90, Math.min(90, yaw)).toFixed(1)),
      pitch: Number(Math.max(-90, Math.min(90, pitch)).toFixed(1)),
      roll: Number(Math.max(-90, Math.min(90, roll)).toFixed(1)),
    };
  }

  /**
   * Estimates pose and applies Exponential Moving Average (EMA) smoothing to prevent jitter.
   */
  public estimatePose(landmarks: FaceLandmark[]): FacePose {
    const raw = this.estimateRawPose(landmarks);

    if (!this.lastPose) {
      this.lastPose = raw;
      return raw;
    }

    const smoothed: FacePose = {
      yaw: Number((this.alpha * raw.yaw + (1 - this.alpha) * this.lastPose.yaw).toFixed(1)),
      pitch: Number((this.alpha * raw.pitch + (1 - this.alpha) * this.lastPose.pitch).toFixed(1)),
      roll: Number((this.alpha * raw.roll + (1 - this.alpha) * this.lastPose.roll).toFixed(1)),
    };

    this.lastPose = smoothed;
    return smoothed;
  }
}
