/**
 * Validates a campaign's `captureAngles` (jsonb `CaptureStep[]`, may be
 * `null` = app default) — see
 * docs/plans/campaign-config-sso-card-photo-discussion.md §3.1.3/§3.1.5.
 *
 * **2026-09-08 rewrite** (product owner decision, see the discussion doc
 * §7's "Đã sửa mâu thuẫn" note so a later reader doesn't mistake this for a
 * regression): the old contract here was 2-5 steps, exactly one `FRONT`,
 * and — when `simultaneousCapture` was on — every step resolving to its own
 * distinct camera role. All three numbers/rules changed:
 *
 * - **2 to 20 steps** (was 2-5): "số lượng ảnh" is now the campaign's own
 *   target count, independent of how many physical cameras a kiosk has —
 *   a kiosk with fewer cameras just runs more capture rounds (§3.1.5).
 * - **Exactly one `isCardSource: true` step** (replaces "exactly one
 *   `FRONT`"): with the angle catalog (§3.1.6) a workflow's steps are no
 *   longer necessarily typed `FRONT`/`LEFT`/... — `type` may be `CUSTOM`
 *   for every step. `isCardSource` (packages/core's new `CaptureStep`
 *   field) is now the single authoritative "this is the ID photo" marker,
 *   so the FRONT-specific rule is dropped rather than kept alongside it.
 * - **No more "distinct camera role when simultaneous" block.** The whole
 *   "simultaneous capture" concept left the campaign for the kiosk's own
 *   Camera Setup (§3.9) — a campaign is never blocked from being created or
 *   run by how many cameras a kiosk happens to have. `computeRequiredCameraCount`
 *   below replaces the hard block with a non-blocking hint the CMS can
 *   display ("cần tối đa K camera").
 *
 * `@face/core` is where `CameraRole`/`CAMERA_ROLES` actually live, but this
 * module deliberately does not import them — see the original 2026-09-05
 * note this carries forward: they were being added there concurrently by
 * another agent and might not exist yet at compile time here. The allowed
 * role set is hardcoded below instead, matching that contract exactly.
 */

const ALLOWED_STEP_TYPES = [
  'FRONT',
  'LEFT',
  'RIGHT',
  'UP',
  'DOWN',
  'CUSTOM',
] as const;
type AllowedStepType = (typeof ALLOWED_STEP_TYPES)[number];

const ALLOWED_CAMERA_ROLES = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'] as const;
type AllowedCameraRole = (typeof ALLOWED_CAMERA_ROLES)[number];

// Lowered from 2 (2026-09-08, product feedback via the CMS's
// CaptureAnglesTable "Số ảnh cần chụp" field) — a campaign targeting a
// single photo is a real, allowed case, not degenerate.
const MIN_STEPS = 1;
const MAX_STEPS = 20;

export type CaptureAnglesValidationResult =
  { ok: true } | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `String(x)` on an `unknown` that might be an object prints the unhelpful `[object Object]` — used for error-message interpolation below instead. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function validateCaptureAngles(
  angles: unknown,
): CaptureAnglesValidationResult {
  // null/undefined = "use the app's hardcoded default workflow" - always
  // allowed (the app default already marks its own card-source step).
  if (angles === null || angles === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(angles)) {
    return { ok: false, reason: 'Danh sách khung chụp không hợp lệ' };
  }

  if (angles.length < MIN_STEPS || angles.length > MAX_STEPS) {
    return {
      ok: false,
      reason: `Cần từ ${MIN_STEPS} đến ${MAX_STEPS} khung hình`,
    };
  }

  let cardSourceCount = 0;

  for (const step of angles) {
    if (!isPlainObject(step)) {
      return { ok: false, reason: 'Danh sách khung chụp không hợp lệ' };
    }

    const type = step.type;
    if (
      typeof type !== 'string' ||
      !ALLOWED_STEP_TYPES.includes(type as AllowedStepType)
    ) {
      return {
        ok: false,
        reason: `Loại khung không hợp lệ: ${describeValue(type)}`,
      };
    }

    const cameraRole = step.cameraRole;
    if (cameraRole !== undefined && cameraRole !== null) {
      if (
        typeof cameraRole !== 'string' ||
        !ALLOWED_CAMERA_ROLES.includes(cameraRole as AllowedCameraRole)
      ) {
        return {
          ok: false,
          reason: `Vai trò camera không hợp lệ: ${describeValue(cameraRole)}`,
        };
      }
    }

    if (step.isCardSource === true) {
      cardSourceCount += 1;
    }
  }

  if (cardSourceCount !== 1) {
    return {
      ok: false,
      reason: `Phải có đúng một khung được đánh dấu ảnh thẻ (isCardSource) — hiện có ${cardSourceCount}`,
    };
  }

  return { ok: true };
}

/**
 * Non-blocking hint for the CMS/CampaignDao: how many distinct physical
 * camera roles this workflow's steps *explicitly* prefer — "the fewest
 * rounds a kiosk with that many cameras could finish this campaign in".
 * Counts only steps that set `cameraRole` explicitly (not the type-default
 * role a step would otherwise fall back to at capture time — that fallback
 * is a kiosk-side runtime decision, not something this pure function should
 * guess at). Falls back to 1 when no step sets one, or when `angles` isn't
 * a usable array (e.g. `null` — app default) — a session always needs at
 * least one camera. Never used to block anything (see this file's own doc
 * comment on why the old "simultaneous" hard block is gone).
 */
export function computeRequiredCameraCount(angles: unknown): number {
  if (!Array.isArray(angles)) {
    return 1;
  }

  const roles = new Set<string>();
  for (const step of angles) {
    if (isPlainObject(step) && typeof step.cameraRole === 'string') {
      roles.add(step.cameraRole);
    }
  }

  return roles.size > 0 ? roles.size : 1;
}
