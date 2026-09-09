import { CAPTURE_STEP_DEFS, StepType } from './captureAngles';
import type { AnglePoseDefault, CameraRoleName, CaptureAnglePreset } from './api';

/**
 * Free-form N-row angle editor's draft row shape — replaces the fixed
 * 5-toggle model `captureAngles.ts`/`CaptureFramesEditor.tsx` used, per
 * `campaign-config-sso-card-photo-discussion.md` §3.1.3/§3.1.6 (a row can
 * repeat an angle at a different degree, e.g. "Trái 15°"/"Trái 30°", and
 * pose is editable per row rather than copied verbatim from the preset).
 * `CaptureFramesEditor.tsx`/`captureAngles.ts` are left as-is (unused by the
 * new `CampaignForm`, kept per this task's "not necessarily deleting"
 * guidance) — this file is a deliberate parallel model, not an edit to that
 * one, so the old file keeps compiling unchanged.
 */
export interface CaptureAngleRow {
  /** Client-only stable key for list rendering/drag-reorder — never sent to the server. */
  key: string;
  /** The catalog preset this row was created from, if any — `undefined` for a manually-built row (still possible pre-catalog, or if the picker's fetch failed). */
  angleCode?: string;
  label: string;
  instruction: string;
  cameraRole: CameraRoleName;
  pose: AnglePoseDefault;
  isCardSource: boolean;
  /**
   * §3.1.6: picking a preset must "bắt buộc xác nhận hoặc sửa góc độ đánh
   * giá" before the row counts as ready — `CaptureAnglesTable` renders an
   * amber outline on the pose cell until this flips to `true` (any edit, or
   * an explicit click into the pose fields, confirms it). Rows loaded from
   * an already-saved campaign start out confirmed.
   */
  confirmed: boolean;
}

let nextKey = 1;
export function makeRowKey(): string {
  nextKey += 1;
  return `row-${nextKey}-${Date.now().toString(36)}`;
}

export function presetToRow(preset: CaptureAnglePreset, isCardSource = false): CaptureAngleRow {
  return {
    key: makeRowKey(),
    angleCode: preset.code,
    label: preset.labelVi,
    instruction: preset.instructionVi ?? '',
    cameraRole: preset.preferredCameraRole,
    pose: preset.poseDefault,
    isCardSource,
    confirmed: false,
  };
}

/** Fallback when the `/v1/capture-angle-presets` catalog hasn't shipped/isn't reachable yet — builds rows from the same 5 fixed angles `CaptureFramesEditor` used, so the form is still usable end to end against an older/partial backend. */
export function fallbackRowsFromStepDefs(): CaptureAngleRow[] {
  const types = Object.keys(CAPTURE_STEP_DEFS) as StepType[];
  return types.map((type) => {
    const def = CAPTURE_STEP_DEFS[type];
    return {
      key: makeRowKey(),
      angleCode: type,
      label: String(def.instruction ?? type),
      instruction: String(def.instruction ?? ''),
      cameraRole: (def.cameraRole as CameraRoleName) ?? 'CENTER',
      pose: (def.pose as AnglePoseDefault) ?? {},
      isCardSource: type === 'FRONT',
      confirmed: true,
    };
  });
}

/**
 * `captureAngles` jsonb shape this app writes for `POST/PATCH /v1/campaigns`
 * — a superset per §3.1.3/§3.1.6 (`angleCode`, free-form `pose`,
 * `isCardSource`).
 *
 * BUG FIX (2026-09-08): this used to omit `type` entirely, but the backend
 * validator (`apps/api/.../capture-angles.validator.ts`) still requires
 * every step to carry one of `FRONT|LEFT|RIGHT|UP|DOWN|CUSTOM` — its own
 * doc comment says as much ("type may be CUSTOM for every step" once the
 * angle catalog is in play), so every save from this free-form editor 400'd
 * with "Loại khung không hợp lệ: undefined". `CUSTOM` is exactly the value
 * that comment describes for a catalog/free-form row — `angleCode`/
 * `isCardSource`/`cameraRole` (all sent explicitly below) are what actually
 * drive behavior downstream now, `type` is kept only because the backend
 * still requires *a* valid value.
 */
export function rowToCaptureStep(row: CaptureAngleRow, index: number): Record<string, unknown> {
  return {
    id: `step-${index}-${row.angleCode ?? 'custom'}`,
    type: 'CUSTOM',
    angleCode: row.angleCode,
    cameraRole: row.cameraRole,
    instruction: row.instruction,
    pose: row.pose,
    isCardSource: row.isCardSource,
    capture: { enabled: true },
  };
}

/** Reverses `rowToCaptureStep` for a campaign loaded from the server — tolerant of the legacy 5-fixed-angle shape (`type` instead of `angleCode`) an older campaign row may still carry. */
export function captureStepToRow(step: Record<string, unknown>): CaptureAngleRow {
  const pose = (step.pose && typeof step.pose === 'object' ? step.pose : {}) as AnglePoseDefault;
  const angleCode = typeof step.angleCode === 'string' ? step.angleCode : typeof step.type === 'string' ? step.type : undefined;
  return {
    key: makeRowKey(),
    angleCode,
    label: angleCode ?? 'Góc chụp',
    instruction: typeof step.instruction === 'string' ? step.instruction : '',
    cameraRole: (step.cameraRole as CameraRoleName) ?? 'CENTER',
    pose,
    isCardSource: step.isCardSource === true,
    confirmed: true,
  };
}

/** "cần tối đa K camera" — distinct, non-empty `cameraRole` values across rows. */
export function requiredCameraCount(rows: CaptureAngleRow[]): number {
  return new Set(rows.map((r) => r.cameraRole).filter(Boolean)).size;
}
