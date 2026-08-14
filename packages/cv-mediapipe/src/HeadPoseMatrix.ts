import { FacePose } from '@face/core';

/**
 * Head pose read from MediaPipe's facial transformation matrix.
 *
 * The 2D fallback infers pitch from how far the nose sits below the eye line,
 * which only works because the nose protrudes about 20 mm. Projected onto the
 * image that offset barely moves: a clearly bowed head shifts the ratio by
 * around 1.5%, where reaching 25 degrees would need 10%. The signal sits inside
 * landmark noise, so no amount of gain tuning recovers it — the angle has to
 * come from a solved 3D pose instead of an image measurement.
 *
 * MediaPipe returns that pose as a 4x4 matrix placing the canonical face model
 * in camera space. Its rotation block is a true rotation, so the angles derived
 * here are real degrees rather than a scaled proxy.
 */

/** Column-major 4x4, as MediaPipe emits it: element (row, col) lives at col*4 + row. */
export type TransformationMatrix = ArrayLike<number>;

const RAD_TO_DEG = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Decompose the rotation block into intrinsic Z-Y-X Euler angles.
 *
 * Returned in the estimator's own convention, which describes the SUBJECT:
 * pitch > 0 looking up, yaw > 0 turned to their own right, roll > 0 tilting
 * their right ear towards their shoulder.
 *
 * Returns null when the matrix is missing or not a rotation — a caller must not
 * receive a plausible-looking angle derived from garbage.
 */
export function poseFromTransformationMatrix(
  matrix: TransformationMatrix | null | undefined
): FacePose | null {
  if (!matrix || matrix.length < 16) return null;

  const at = (row: number, col: number) => matrix[col * 4 + row];

  const r00 = at(0, 0);
  const r10 = at(1, 0);
  const r20 = at(2, 0);
  const r21 = at(2, 1);
  const r22 = at(2, 2);

  if (![r00, r10, r20, r21, r22].every(Number.isFinite)) return null;

  // A rotation matrix has unit-length columns; anything else means the caller
  // handed us something that is not a pose.
  const col2 = Math.hypot(at(0, 2), at(1, 2), at(2, 2));
  if (!(col2 > 0.5 && col2 < 1.5)) return null;

  // Inverse of the R = Rz * Ry * Rx composition. Reading the wrong elements
  // still round-trips every single-axis rotation, so a mismatch only shows up
  // once two axes move at once — which is every real head pose.
  const yRad = Math.asin(clamp(-r20, -1, 1));
  const cosY = Math.cos(yRad);

  let xRad: number;
  let zRad: number;
  if (Math.abs(cosY) < 1e-6) {
    // Looking straight up or down collapses roll and yaw onto the same axis;
    // attributing the leftover rotation to roll keeps the result continuous.
    xRad = 0;
    zRad = Math.atan2(-at(0, 1), at(1, 1));
  } else {
    xRad = Math.atan2(r21, r22);
    zRad = Math.atan2(r10, r00);
  }

  // MediaPipe's canonical face looks down its own +Z with +Y up, so a positive
  // rotation about +X tips the crown towards the camera — the subject looking
  // DOWN. Pitch is negated to keep "up is positive" as documented on FacePose.
  //
  // Confirmed on the deployed kiosk: a comfortably bowed head reads -24. The
  // 2D fallback managed -4 for the same pose, which is what made the DOWN step
  // impossible to complete.
  return {
    pitch: round(-xRad * RAD_TO_DEG),
    yaw: round(yRad * RAD_TO_DEG),
    roll: round(zRad * RAD_TO_DEG),
  };
}

function round(deg: number): number {
  return Number(clamp(deg, -90, 90).toFixed(1));
}

/**
 * Build a column-major matrix for known angles.
 *
 * Exists so the decomposition can be checked against rotations whose angles are
 * known by construction, rather than against whatever a camera happened to
 * produce on the day.
 */
export function transformationMatrixFromEuler(
  pitchDeg: number,
  yawDeg: number,
  rollDeg: number
): number[] {
  const x = (-pitchDeg / RAD_TO_DEG);
  const y = yawDeg / RAD_TO_DEG;
  const z = rollDeg / RAD_TO_DEG;

  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);

  // R = Rz * Ry * Rx, matching the decomposition above.
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  // Column-major: each group of four is one column.
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    0, 0, 0, 1,
  ];
}
