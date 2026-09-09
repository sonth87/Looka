import {
  CAMERA_ROLES,
  CameraRole,
  CaptureStep,
  CaptureWorkflow,
  StepType,
  defaultCameraRoleForStepType,
} from '@face/core';

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

// ---------------------------------------------------------------------------
// Round planning (discussion doc §3.1.5 "Quy tắc phủ N ảnh bằng K camera",
// bổ sung 2026-09-08) — replaces the old "block the whole session when a
// step's preferred camera isn't mapped" behaviour above with "always plan
// something, using whatever cameras this kiosk actually has."
//
// `checkFramesReadiness` above is left untouched: it still backs the
// existing simultaneous-capture flow in FaceCaptureApp.tsx (session start,
// hot-unplug re-check, duplicate-device detection), none of which this pass
// rewires — see the TODO at FaceCaptureApp.tsx's session-start call site
// (`runFramePreflight`/`if (!preflight.ok) return false;`) for exactly what
// switching that call site over to `planCaptureRounds` below would involve.
// This section only adds the new planning primitive itself, fully
// implemented and unit-tested, per the product decision that a session
// should only ever refuse to start when the kiosk has *zero* cameras mapped
// at all (§3.1.5's opening line: "Phiên chỉ bị chặn khi không có camera
// nào").
// ---------------------------------------------------------------------------

/** Physical mounting yaw/pitch of one logical camera role, in degrees. */
export interface PhysicalCameraAngles {
  yaw: number;
  pitch: number;
}

/**
 * Default physical mounting angles, used until a kiosk has its own
 * `camera.physicalAngles` configured (Cài đặt thiết bị, §3.9 — a follow-up
 * pass; see this file's `planCaptureRounds` doc comment for how to plug real
 * per-device values in once that exists). Mirrors §3.9's own defaults
 * exactly: CENTER faces straight ahead by convention; LEFT/RIGHT are
 * mounted ∓30° off axis; UP/DOWN ±25° of pitch. These are deliberately NOT
 * the same numbers as `defaultWorkflow`'s pose *targets* in
 * FaceCaptureApp.tsx (yaw ∓22.5°, pitch ±25°) — those describe what angle a
 * step asks the *subject's face* to reach, a completely different thing
 * from where a side camera is physically bolted.
 */
export const DEFAULT_PHYSICAL_ANGLES: Record<CameraRole, PhysicalCameraAngles> = {
  CENTER: { yaw: 0, pitch: 0 },
  LEFT: { yaw: -30, pitch: 0 },
  RIGHT: { yaw: 30, pitch: 0 },
  UP: { yaw: 0, pitch: 25 },
  DOWN: { yaw: 0, pitch: -25 },
};

/** Per-role override of `DEFAULT_PHYSICAL_ANGLES`, e.g. from `camera.physicalAngles`. */
export type PhysicalAngleMap = Partial<Record<CameraRole, Partial<PhysicalCameraAngles>>>;

/** Kiosk-local setting (§3.9) — no longer a campaign flag (`simultaneous_capture` retired). */
export type CaptureSequencing = 'sequential' | 'simultaneous';

/** One step's resolved camera + gate pose within a capture plan. */
export interface RoundStepPlan {
  step: CaptureStep;
  /** The physical camera role that will actually take this step's photo — its own `cameraRole` preference when mapped, otherwise the fallback role. */
  cameraRole: CameraRole;
  /**
   * The pose the subject must hold, expressed on the CV-analysed camera
   * (CENTER) — `step.pose.yaw.target - physicalAngle(cameraRole).yaw`
   * (§3.1.5 step 2's `gateYaw` formula). `undefined` when the step declares
   * no yaw target at all (e.g. a pitch-only UP/DOWN step).
   */
  effectiveYaw?: number;
  /** Same idea as `effectiveYaw`, for pitch. */
  effectivePitch?: number;
  /** True when `cameraRole` differs from the step's own `cameraRole` preference (or its type default) — i.e. this photo is a fallback, subject-turns-instead-of-camera-moves shot (Q18: accepted, tagged `fallback: true` in photo metadata downstream). */
  isFallback: boolean;
}

/** One round: every step in it fires together (simultaneous mode) or is the sole step of its own round (sequential mode). */
export interface CaptureRound {
  steps: RoundStepPlan[];
}

/** Output of `planCaptureRounds` — what `FaceCaptureApp.tsx` should drive the capture screen from once wired up (see this file's header comment). */
export interface CapturePlan {
  /** True only when the kiosk has no camera mapped to any role at all — the one case §3.1.5 still blocks. */
  blocked: boolean;
  /** Vietnamese, user-facing — set only when `blocked`. */
  reason?: string;
  rounds: CaptureRound[];
}

const DEFAULT_GATE_TOLERANCE_DEG = 0.01;

function resolvePhysicalAngle(role: CameraRole, overrides?: PhysicalAngleMap): PhysicalCameraAngles {
  const base = DEFAULT_PHYSICAL_ANGLES[role];
  const override = overrides?.[role];
  return override ? { ...base, ...override } : base;
}

function anglesMatch(a: number | undefined, b: number | undefined, tolerance: number): boolean {
  // Either side leaving an axis unconstrained never blocks a match — a
  // pitch-only step (UP/DOWN) has nothing to say about yaw, so it must not
  // refuse to share a round with a step that does specify one.
  if (a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= tolerance;
}

/**
 * Resolves which physical camera actually takes `step`'s photo: its own
 * preferred role (`step.cameraRole`, or the type default) when that role has
 * a mapped camera; otherwise CENTER when CENTER is mapped, otherwise the
 * kiosk's one and only mapped camera (§3.1.5 step 1's two named cases).
 *
 * A kiosk with, say, only LEFT+RIGHT mapped (no CENTER) is not covered by
 * either of the doc's two named cases — reasonable enough on real hardware
 * to still produce a plan for rather than special-case into blocking, so
 * this falls through to "the first mapped role in `CAMERA_ROLES` order" for
 * that situation, deterministically.
 */
function resolveStepCamera(
  step: CaptureStep,
  mappedRoles: ReadonlySet<CameraRole>
): { cameraRole: CameraRole; isFallback: boolean } {
  const preferredRole = step.cameraRole ?? defaultCameraRoleForStepType(step.type);
  if (mappedRoles.has(preferredRole)) {
    return { cameraRole: preferredRole, isFallback: false };
  }
  if (mappedRoles.has('CENTER')) {
    return { cameraRole: 'CENTER', isFallback: true };
  }
  if (mappedRoles.size === 1) {
    const [soleRole] = mappedRoles;
    return { cameraRole: soleRole, isFallback: true };
  }
  // No CENTER and more than one candidate: pick deterministically rather
  // than arbitrarily by Set iteration order.
  const fallbackRole = CAMERA_ROLES.find((role) => mappedRoles.has(role))!;
  return { cameraRole: fallbackRole, isFallback: true };
}

function planStep(
  step: CaptureStep,
  mappedRoles: ReadonlySet<CameraRole>,
  physicalAngles: PhysicalAngleMap | undefined
): RoundStepPlan {
  const { cameraRole, isFallback } = resolveStepCamera(step, mappedRoles);
  const physical = resolvePhysicalAngle(cameraRole, physicalAngles);
  const effectiveYaw =
    step.pose?.yaw !== undefined ? step.pose.yaw.target - physical.yaw : undefined;
  const effectivePitch =
    step.pose?.pitch !== undefined ? step.pose.pitch.target - physical.pitch : undefined;
  return { step, cameraRole, effectiveYaw, effectivePitch, isFallback };
}

/**
 * Builds a kiosk-specific capture plan out of a campaign's steps and this
 * machine's camera role mapping (discussion doc §3.1.5) — the replacement
 * for the old "refuse to start when any step's camera is missing" rule.
 * Blocks only when `roleMapping` has no usable entry at all; every other
 * combination of steps × cameras produces *some* plan, falling back to
 * CENTER (subject turns their head) for whichever steps' preferred camera
 * isn't physically present.
 *
 * **Simultaneous mode** (`sequencing` omitted or `'simultaneous'`): steps
 * are packed into rounds with a simple greedy, single-pass-in-input-order
 * algorithm — a step joins the first open round whose gate pose doesn't
 * conflict with its own (§3.1.5 step 2's `anglesMatch`, axis-by-axis, an
 * unconstrained axis never conflicts) and that doesn't already have a step
 * using the same physical camera; failing that, it opens a new round. This
 * is deliberately not an optimal bin-packing search — see this function's
 * own module header comment for why a straightforward greedy pass is
 * enough here (it reproduces the discussion doc's own worked 10-photo/
 * 2-camera example exactly; see `multiFrame.test.ts`).
 *
 * **Sequential mode** (§3.9's kiosk-local "Cách chụp" setting): every step
 * is its own round — same per-step camera/gate resolution, just never
 * grouped, so no two cameras ever fire at once.
 *
 * `physicalAngles` lets a caller override `DEFAULT_PHYSICAL_ANGLES` per
 * role (e.g. once `camera.physicalAngles` — §3.9, `apps/desktop`'s
 * `secrets.ts` — is wired up and read on the renderer side); omitted roles
 * keep the default.
 */
export function planCaptureRounds(
  steps: CaptureStep[],
  roleMapping: Partial<Record<CameraRole, string>>,
  options?: {
    sequencing?: CaptureSequencing;
    physicalAngles?: PhysicalAngleMap;
    /** Degrees of slack when comparing two steps' gate poses for round-compatibility. Default 0.01°. */
    gateTolerance?: number;
  }
): CapturePlan {
  const mappedRoles = new Set<CameraRole>(
    CAMERA_ROLES.filter((role) => !!roleMapping[role])
  );

  if (mappedRoles.size === 0) {
    return {
      blocked: true,
      reason: 'Chưa gán camera nào cho máy này',
      rounds: [],
    };
  }

  const plans = steps.map((step) => planStep(step, mappedRoles, options?.physicalAngles));

  if (options?.sequencing === 'sequential') {
    return { blocked: false, rounds: plans.map((plan) => ({ steps: [plan] })) };
  }

  const tolerance = options?.gateTolerance ?? DEFAULT_GATE_TOLERANCE_DEG;
  const rounds: CaptureRound[] = [];
  // Parallel to `rounds` — the yaw/pitch each round has committed to so far
  // (first step to constrain an axis decides it for the round; see
  // `anglesMatch`) and which physical cameras are already spoken for.
  const roundGates: Array<{ yaw?: number; pitch?: number; roles: Set<CameraRole> }> = [];

  for (const plan of plans) {
    let placed = false;
    for (let i = 0; i < rounds.length; i++) {
      const gate = roundGates[i];
      if (gate.roles.has(plan.cameraRole)) continue;
      if (!anglesMatch(gate.yaw, plan.effectiveYaw, tolerance)) continue;
      if (!anglesMatch(gate.pitch, plan.effectivePitch, tolerance)) continue;

      rounds[i].steps.push(plan);
      gate.roles.add(plan.cameraRole);
      if (gate.yaw === undefined) gate.yaw = plan.effectiveYaw;
      if (gate.pitch === undefined) gate.pitch = plan.effectivePitch;
      placed = true;
      break;
    }
    if (!placed) {
      rounds.push({ steps: [plan] });
      roundGates.push({
        yaw: plan.effectiveYaw,
        pitch: plan.effectivePitch,
        roles: new Set([plan.cameraRole]),
      });
    }
  }

  return { blocked: false, rounds };
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
