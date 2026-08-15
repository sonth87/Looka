import { BoundingBox } from '@face/core';

/**
 * How far the subject is standing from the camera.
 *
 * A pinhole camera projects an object of real width W, at distance D, onto
 *
 *   w_px = W * f_px / D
 *
 * where f_px is the focal length expressed in pixels. A lens quoted by its
 * horizontal field of view F gives
 *
 *   f_px = (frameWidth / 2) / tan(F / 2)
 *
 * Substituting and solving for D, with ratio = w_px / frameWidth, the frame
 * width cancels out entirely:
 *
 *   D = W / (2 * ratio * tan(F / 2))
 *
 * So distance depends only on how much of the frame the face spans and on the
 * lens — not on the sensor resolution. Doubling the capture resolution does not
 * let anyone stand further away.
 *
 * The accuracy ceiling is W: real faces vary by roughly +/-10%, and the field of
 * view of a webcam is rarely published. Treat the output as a band, which is why
 * `estimateDistance` returns one rather than a single number.
 */

/**
 * Cheekbone-to-cheekbone width in metres.
 *
 * The bounding box is the hull of the face-mesh landmarks, which stops at the
 * face silhouette rather than the full breadth of the head — an adult measures
 * about 14 cm across there, against roughly 15.5 cm ear to ear.
 */
export const DEFAULT_FACE_WIDTH_M = 0.14;

/** Horizontal field of view typical of a laptop or USB webcam, in degrees. */
export const DEFAULT_FOV_RANGE_DEG: readonly [number, number] = [60, 70];

export interface DistanceEstimate {
  /** Nearest plausible distance in metres, from the widest assumed lens. */
  minMeters: number;
  /** Furthest plausible distance in metres, from the narrowest assumed lens. */
  maxMeters: number;
  /** Midpoint, for display where a single figure is needed. */
  meters: number;
  /** Fraction of the frame width the face spans; the input the estimate rests on. */
  faceSizeRatio: number;
}

export interface DistanceOptions {
  /** Real face width in metres. Override for a known population. */
  faceWidthMeters?: number;
  /** Horizontal field of view range in degrees, or a single known value. */
  fovDegrees?: number | readonly [number, number];
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Distance for one specific field of view. */
function distanceForFov(faceWidthM: number, ratio: number, fovDeg: number): number {
  return faceWidthM / (2 * ratio * Math.tan(toRadians(fovDeg) / 2));
}

/**
 * Estimate how far the face is from the camera.
 *
 * Returns null when the face spans nothing measurable — a zero-width box means
 * no detection, and a fabricated distance there would read as a real reading.
 */
export function estimateDistance(
  boundingBox: BoundingBox,
  frameWidth: number,
  options: DistanceOptions = {}
): DistanceEstimate | null {
  if (!frameWidth || boundingBox.width <= 0) return null;

  const ratio = boundingBox.width / frameWidth;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const faceWidthM = options.faceWidthMeters ?? DEFAULT_FACE_WIDTH_M;
  const fov = options.fovDegrees ?? DEFAULT_FOV_RANGE_DEG;
  const [wideFov, narrowFov] = typeof fov === 'number' ? [fov, fov] : fov;

  // A wider lens fits the same face into a smaller fraction of the frame, so for
  // a given ratio it implies the subject is nearer.
  const minMeters = distanceForFov(faceWidthM, ratio, wideFov);
  const maxMeters = distanceForFov(faceWidthM, ratio, narrowFov);

  return {
    minMeters: Math.min(minMeters, maxMeters),
    maxMeters: Math.max(minMeters, maxMeters),
    meters: (minMeters + maxMeters) / 2,
    faceSizeRatio: ratio,
  };
}

/**
 * The face-size ratio a given distance would produce — the inverse of the above.
 *
 * Used to turn a distance target into the ratio the quality gates speak in.
 */
export function faceSizeRatioAtDistance(
  meters: number,
  options: DistanceOptions = {}
): number {
  const faceWidthM = options.faceWidthMeters ?? DEFAULT_FACE_WIDTH_M;
  const fov = options.fovDegrees ?? DEFAULT_FOV_RANGE_DEG;
  const [wideFov, narrowFov] = typeof fov === 'number' ? [fov, fov] : fov;
  const midFov = (wideFov + narrowFov) / 2;

  if (meters <= 0) return 1;
  return faceWidthM / (2 * meters * Math.tan(toRadians(midFov) / 2));
}

/**
 * How much magnification would bring the face to a target share of the frame.
 *
 * Returns 1 when the face is already at or above the target: enlarging past that
 * point only spreads the same pixels over more screen, and cropping into the
 * frame to achieve it would throw away the detail a captured photo depends on.
 */
export function zoomFactorToReach(
  currentRatio: number,
  targetRatio: number,
  maxZoom = 3
): number {
  if (currentRatio <= 0 || targetRatio <= 0) return 1;
  if (currentRatio >= targetRatio) return 1;
  return Math.min(maxZoom, targetRatio / currentRatio);
}
