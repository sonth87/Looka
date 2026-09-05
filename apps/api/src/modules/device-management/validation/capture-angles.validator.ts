/**
 * Validates a campaign's `captureAngles` (jsonb `CaptureStep[]`, may be
 * `null` = app default) against the contract in
 * docs/plans/multi-camera-device-management-discussion.md: 3 to 5 steps,
 * exactly one `FRONT`, only known step types, and — when the campaign has
 * `simultaneousCapture` on — every step resolving to its own physical
 * camera.
 *
 * `@face/core` is where `CameraRole`/`CAMERA_ROLES`/
 * `defaultCameraRoleForStepType` actually live, but this module deliberately
 * does not import them: they are being added there concurrently by another
 * agent and may not exist yet at compile time here. The allowed role set and
 * the type->role default are hardcoded below instead, matching that
 * contract exactly; once the package export lands, callers can switch over
 * without changing this function's behavior.
 */

const ALLOWED_STEP_TYPES = ['FRONT', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'CUSTOM'] as const;
type AllowedStepType = (typeof ALLOWED_STEP_TYPES)[number];

const ALLOWED_CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;
type AllowedCameraRole = (typeof ALLOWED_CAMERA_ROLES)[number];

const MIN_STEPS = 3;
const MAX_STEPS = 5;

export type CaptureAnglesValidationResult = { ok: true } | { ok: false; reason: string };

/** Mirrors `defaultCameraRoleForStepType` in `@face/core`'s workflow types. */
function defaultRoleForType(type: AllowedStepType): AllowedCameraRole {
  switch (type) {
    case 'FRONT':
      return 'CENTER';
    case 'LEFT':
      return 'LEFT';
    case 'RIGHT':
      return 'RIGHT';
    case 'UP':
      return 'UP';
    case 'DOWN':
      return 'DOWN';
    default:
      return 'CENTER';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateCaptureAngles(
  angles: unknown,
  simultaneousCapture: boolean,
): CaptureAnglesValidationResult {
  // null/undefined = "use the app's hardcoded default workflow" - always
  // allowed, regardless of simultaneousCapture (the app default already
  // maps one role per step).
  if (angles === null || angles === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(angles)) {
    return { ok: false, reason: 'Danh sách khung chụp không hợp lệ' };
  }

  if (angles.length < MIN_STEPS || angles.length > MAX_STEPS) {
    return { ok: false, reason: 'Cần từ 3 đến 5 khung hình' };
  }

  let frontCount = 0;
  const effectiveRoles: AllowedCameraRole[] = [];

  for (const step of angles) {
    if (!isPlainObject(step)) {
      return { ok: false, reason: 'Danh sách khung chụp không hợp lệ' };
    }

    const type = step.type;
    if (typeof type !== 'string' || !ALLOWED_STEP_TYPES.includes(type as AllowedStepType)) {
      return { ok: false, reason: `Loại khung không hợp lệ: ${String(type)}` };
    }

    if (type === 'FRONT') frontCount += 1;

    const cameraRole = step.cameraRole;
    if (cameraRole !== undefined && cameraRole !== null) {
      if (
        typeof cameraRole !== 'string' ||
        !ALLOWED_CAMERA_ROLES.includes(cameraRole as AllowedCameraRole)
      ) {
        return { ok: false, reason: `Vai trò camera không hợp lệ: ${String(cameraRole)}` };
      }
    }

    const effectiveRole = (
      cameraRole !== undefined && cameraRole !== null
        ? (cameraRole as AllowedCameraRole)
        : defaultRoleForType(type as AllowedStepType)
    );
    effectiveRoles.push(effectiveRole);
  }

  if (frontCount !== 1) {
    return { ok: false, reason: 'Phải có đúng một khung FRONT' };
  }

  if (simultaneousCapture) {
    const seen = new Set<AllowedCameraRole>();
    for (const role of effectiveRoles) {
      if (seen.has(role)) {
        return {
          ok: false,
          reason: `Chụp đồng thời cần mỗi khung một camera riêng: trùng vai trò ${role}`,
        };
      }
      seen.add(role);
    }
  }

  return { ok: true };
}
