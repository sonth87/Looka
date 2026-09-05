import { CameraRole, CaptureWorkflow, StepType, defaultCameraRoleForStepType } from '@face/core';

/**
 * Vietnamese labels for the operator-facing camera role badges (multi-frame
 * simultaneous capture grid, FramesBlockedPanel's problem list).
 */
export const CAMERA_ROLE_LABELS_VI: Record<CameraRole, string> = {
  CENTER: 'Camera giữa',
  LEFT: 'Camera trái',
  RIGHT: 'Camera phải',
  UP: 'Camera trên',
  DOWN: 'Camera dưới',
};

/**
 * One workflow step, reduced to what the multi-frame grid needs to render a
 * tile for it and to resolve which physical camera feeds it.
 */
export interface FrameSpec {
  stepId: string;
  type: StepType;
  role: CameraRole;
  /** The step's type, same value shown on the sequential path's step chips. */
  label: string;
  instruction: string;
}

/**
 * One tile per workflow step, in step order — a campaign with
 * `simultaneousCapture` renders every one of these at once instead of
 * stepping through them sequentially. `step.cameraRole` wins when the
 * campaign set one explicitly; otherwise falls back to the step type's
 * default camera (see `defaultCameraRoleForStepType`).
 */
export function framesForWorkflow(workflow: CaptureWorkflow): FrameSpec[] {
  return workflow.steps.map((step) => ({
    stepId: step.id,
    type: step.type,
    role: step.cameraRole ?? defaultCameraRoleForStepType(step.type),
    label: step.type,
    instruction: step.instruction,
  }));
}

/** A frame plus whether its role currently resolves to a connected physical camera. */
export interface FrameReadiness extends FrameSpec {
  deviceId: string | null;
  deviceLabel: string | null;
  connected: boolean;
}

/**
 * Simultaneous-capture readiness verdict for a whole workflow — computed
 * fresh before every live-mode session start/restart (§ "if any frame lacks
 * a connected, distinct camera, the session must NOT start").
 */
export interface FramePreflight {
  ok: boolean;
  frames: FrameReadiness[];
  /** Frames with no camera mapped to their role, or a mapped camera that isn't plugged in. */
  missing: FrameReadiness[];
  /** Groups of 2+ frames whose roles resolve to the very same physical camera. */
  duplicates: FrameReadiness[][];
}

/**
 * Checks every frame's role against the kiosk's camera role mapping and the
 * cameras currently plugged in. A frame is "missing" when its role has no
 * mapped device at all, or the mapped device id no longer appears in
 * `devices` (unplugged, or never was). Two or more frames landing on the
 * same physical device — the desktop Camera Setup screen does not itself
 * forbid this — are reported as `duplicates` instead: each needs its own
 * camera for a true simultaneous shot to make sense.
 */
export function checkFramesReadiness(
  frames: FrameSpec[],
  roleMapping: Partial<Record<CameraRole, string>>,
  devices: Array<{ id: string; label: string }>
): FramePreflight {
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  const readiness: FrameReadiness[] = frames.map((frame) => {
    const deviceId = roleMapping[frame.role] ?? null;
    const device = deviceId ? deviceById.get(deviceId) ?? null : null;
    return {
      ...frame,
      deviceId,
      deviceLabel: device?.label ?? null,
      connected: !!device,
    };
  });

  const missing = readiness.filter((f) => !f.deviceId || !f.connected);

  const groupsByDevice = new Map<string, FrameReadiness[]>();
  for (const f of readiness) {
    if (!f.deviceId || !f.connected) continue; // already reported as missing, not a duplicate
    const group = groupsByDevice.get(f.deviceId) ?? [];
    group.push(f);
    groupsByDevice.set(f.deviceId, group);
  }
  const duplicates = Array.from(groupsByDevice.values()).filter((group) => group.length > 1);

  return {
    ok: missing.length === 0 && duplicates.length === 0,
    frames: readiness,
    missing,
    duplicates,
  };
}

/**
 * Grabs a still frame from a live `<video>` element as a JPEG data URL, at
 * the video's own native resolution — used to snapshot every non-CENTER
 * frame the instant the CENTER camera actually captures (see
 * FaceCaptureApp's capture-trigger handler), instead of waiting on a second
 * round trip through each frame's own capture pipeline. Not mirrored: this
 * is process evidence like the other frame streams, not the print-quality
 * CENTER still.
 *
 * Guarded against a near-black/blank frame (2026-09-05 field bug — see
 * `isFrameLikelyBlank`'s own doc comment): a `null` return here means
 * "treat as no snapshot", same as the existing `videoWidth === 0` guard —
 * callers already leave the frame pending for retake in that case.
 */
export function snapshotVideoFrame(video: HTMLVideoElement, quality = 0.92): string | null {
  if (video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (isCanvasLikelyBlank(canvas)) return null;

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscales the already-drawn canvas to a small, cheap-to-read-back sample
 * and runs the luminance guard (`isFrameLikelyBlank`) over it. Kept
 * separate from `isFrameLikelyBlank` itself so the actual luminance/variance
 * math stays a pure function over a plain `Uint8ClampedArray` — unit-tested
 * directly in `__tests__/multiFrame.test.ts` without needing a real
 * `<canvas>` (packages/ui's test suite runs under plain `node:test`, with no
 * DOM/canvas available).
 */
function isCanvasLikelyBlank(sourceCanvas: HTMLCanvasElement): boolean {
  const SAMPLE_SIZE = 32;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_SIZE;
  sampleCanvas.height = SAMPLE_SIZE;
  const sampleCtx = sampleCanvas.getContext('2d');
  if (!sampleCtx) return false; // no 2D context available — don't block a real capture over it

  sampleCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return isFrameLikelyBlank(data, SAMPLE_SIZE, SAMPLE_SIZE, { stride: 1 });
}

/**
 * Coarse near-black / near-uniform rejection for a captured frame's raw
 * pixel data — the 2026-09-05 field bug this defends against: in a
 * simultaneous-capture session the RIGHT side camera's offscreen `<video>`
 * still hadn't rendered a single real frame (still negotiating with the OS
 * driver — its on-screen tile read "Chờ", not "Sẵn sàng") at the instant the
 * CENTER shutter fired. `snapshotVideoFrame` had no gate at all before this,
 * so it drew and returned a fully black canvas, which was then approved and
 * uploaded to fs-core untouched (`face-step-right-2.jpg`, a flat black
 * 1280x720 JPEG).
 *
 * Samples every `stride`th pixel (cheap and roughly right is the point, not
 * exact — the caller already downscales to a small canvas before calling
 * this) and rejects when either:
 *  - the mean luminance is below `minMeanLuminance` (near-black), or
 *  - the luminance variance is below `minVariance` (a flat, uniform frame —
 *    the common case is black, but a stuck driver returning a solid gray
 *    frame reads the same way and is just as unusable).
 */
export function isFrameLikelyBlank(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: { minMeanLuminance?: number; minVariance?: number; stride?: number } = {}
): boolean {
  const { minMeanLuminance = 12, minVariance = 4, stride = 7 } = options;
  if (width <= 0 || height <= 0 || pixels.length < 4) return true;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4 * stride) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    // Rec. 601 luma — cheap and good enough for a coarse blank check.
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luminance;
    sumSq += luminance * luminance;
    count++;
  }
  if (count === 0) return true;

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return mean < minMeanLuminance || variance < minVariance;
}

/**
 * Whether every non-CENTER frame has actually rendered a real video frame
 * yet — CENTER is excluded since it is the CV-analysed camera the engine's
 * own quality gate (`faceState.quality.accepted`) already covers; only the
 * side frames (snapshotted with no gate of their own, see
 * `snapshotVideoFrame`) need this. Backs the shutter-enable state in
 * simultaneous-capture mode (2026-09-05 field bug — see this file's other
 * doc comments in this section): a frame whose device is connected and
 * mapped (`checkFramesReadiness` says OK) can still not yet be delivering
 * pixels, and the shutter must stay disabled until it is.
 */
export function allSideFramesReady(frames: FrameSpec[], frameReadiness: Record<string, boolean>): boolean {
  return frames.filter((f) => f.role !== 'CENTER').every((f) => frameReadiness[f.stepId] === true);
}

/**
 * The first not-yet-ready side frame's camera role, for the "Đang chờ
 * camera <role>…" shutter hint — `null` once every side frame is ready (or
 * the workflow has none). Frame order (workflow step order) decides which
 * one is reported when more than one is still not ready.
 */
export function firstNotReadyFrameRole(
  frames: FrameSpec[],
  frameReadiness: Record<string, boolean>
): CameraRole | null {
  const notReady = frames.filter((f) => f.role !== 'CENTER').find((f) => frameReadiness[f.stepId] !== true);
  return notReady ? notReady.role : null;
}
