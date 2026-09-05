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
 */
export function snapshotVideoFrame(video: HTMLVideoElement, quality = 0.92): string | null {
  if (video.videoWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
